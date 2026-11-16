import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attendanceShiftId, dailyAttendance, dropoutShiftCounts, shiftAttendanceColumns } from './attendanceShifts';
import { matchesSurveyResponseFilters } from './surveyFilters';
import { isDayFiveSurveyEligible } from '../../backend/src/services/trainingSchedule';
import type { AttendanceRecord } from '../types';

const mark = (id: string, turno?: 'AM' | 'PM', estado_asistencia: AttendanceRecord['estado_asistencia'] = 'Asistió'): AttendanceRecord => ({
  id, participant_id: 'p', training_session_id: 's', dia: 5, turno, estado_asistencia,
  fecha: '2026-11-16', fecha_registro: '2026-11-16T15:00:00Z', registrado_por: 'trainer',
});
test('two shifts are independent; daily eligibility accepts either shift without doubling counts', () => {
  assert.notEqual(attendanceShiftId('s', 'p', 5, 'AM'), attendanceShiftId('s', 'p', 5, 'PM'));
  const participant = { id: 'p', training_session_id: 's', resultado_formacion: 'Apto' };
  for (const records of [[mark('am', 'AM'), mark('pm', 'PM', 'Faltó')], [mark('am', 'AM', 'Faltó'), mark('pm', 'PM')]]) {
    assert.equal(dailyAttendance(records).length, 1);
    assert.equal(dailyAttendance(records)[0].estado_asistencia, 'Asistió');
    assert.equal(isDayFiveSurveyEligible(participant, records), true);
  }
});
test('first dropout is counted once by day and shift, preserving unknown historical shift', () => {
  const records = [mark('pm', 'PM', 'Baja'), mark('am', 'AM', 'Baja'),
    { ...mark('next', 'AM', 'Baja'), dia: 6 },
    { ...mark('old', undefined, 'Desistió'), participant_id: 'q' },
    { ...mark('afternoon', 'PM', 'Desistió'), participant_id: 'r' }];
  assert.deepEqual(dropoutShiftCounts(records).map(r => r.cantidad), [1, 1, 1]);
});
test('exports keep legacy and both shifts in separate labeled columns', () => {
  const result = shiftAttendanceColumns([mark('old', undefined, 'Feriado'), mark('am', 'AM'), mark('pm', 'PM', 'Faltó')], 's', 'p');
  assert.equal(result['Día 5 AM'], 'Asistió');
  assert.equal(result['Día 5 PM'], 'Faltó');
  assert.equal(result['Día 5 Sin turno'], 'Feriado');
  assert.equal(Object.keys(result).length, 15);
});
test('survey response filters use Lima dates and exact normalized campaigns', () => {
  const response = { fecha_respuesta: '2026-11-17T02:30:00Z', campaña: 'Culqi' };
  assert.equal(matchesSurveyResponseFilters(response, ' CULQI ', '2026-11-16', '2026-11-16'), true);
  assert.equal(matchesSurveyResponseFilters(response, '', '2026-11-17', ''), false);
  assert.equal(matchesSurveyResponseFilters(response, 'GPON', '', ''), false);
  assert.equal(matchesSurveyResponseFilters(response, '', '2026-11-18', '2026-11-16'), false);
});

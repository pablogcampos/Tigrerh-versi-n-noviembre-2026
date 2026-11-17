import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attendanceShiftId, dailyAttendance, dropoutShiftCounts, shiftAttendanceColumns } from './attendanceShifts';
import { matchesSurveyResponseFilters } from './surveyFilters';
import { isDayFiveSurveyEligible } from '../../backend/src/services/trainingSchedule';
import type { AttendanceRecord } from '../types';
import { calculatePhaseMetrics } from '../../backend/src/services/trainingPhaseMetrics';
import { planShiftContinuations } from '../../backend/src/services/attendanceShiftPolicy';

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
  assert.equal(Object.keys(result).length, 45);
  assert.match(result['Día 5 AM - Registro (Perú)'], /16\/11\/2026.*10:00:00/);
  assert.equal(result['Día 5 AM - Origen'], 'Registro directo');
  const automatic = shiftAttendanceColumns([{ ...mark('pm', 'PM', 'Baja'), propagado_desde: 'am' }], 's', 'p');
  assert.equal(automatic['Día 5 PM - Origen'], 'Propagado automáticamente');
});

test('a terminal shift impacts daily outcome, dashboard and eligibility despite presence in another shift', () => {
  const records = [{ ...mark('d1', 'AM'), dia: 1 }, mark('am', 'AM'), mark('pm', 'PM', 'Baja')];
  assert.equal(dailyAttendance(records).find((r) => r.dia === 5)?.estado_asistencia, 'Baja');
  const metrics = calculatePhaseMetrics(new Set(['p']), records, []);
  assert.equal(metrics.altasFinalIds.size, 0);
  assert.equal(metrics.desercionesFinales, 1);
  assert.equal(metrics.desercionFinalRate, 100);
  assert.equal(isDayFiveSurveyEligible({ id: 'p', training_session_id: 's', resultado_formacion: 'Apto' }, records), false);
  assert.deepEqual(dropoutShiftCounts(records).map((r) => r.cantidad), [0, 1, 0]);
  const firstDayDropout = [{ ...mark('am', 'AM', 'Desistió'), dia: 1 }];
  assert.equal(calculatePhaseMetrics(new Set(['p']), firstDayDropout, []).desercionFinalRate, 100);
  assert.equal(calculatePhaseMetrics(new Set(), records, []).desercionesFinales, 0);
});
test('survey response filters use Lima dates and exact normalized campaigns', () => {
  const response = { fecha_respuesta: '2026-11-17T02:30:00Z', campaña: 'Culqi' };
  assert.equal(matchesSurveyResponseFilters(response, ' CULQI ', '2026-11-16', '2026-11-16'), true);
  assert.equal(matchesSurveyResponseFilters(response, '', '2026-11-17', ''), false);
  assert.equal(matchesSurveyResponseFilters(response, 'GPON', '', ''), false);
  assert.equal(matchesSurveyResponseFilters(response, '', '2026-11-18', '2026-11-16'), false);
});

test('both dropout statuses cover all remaining shifts, never earlier slots or D6', () => {
  for (const status of ['Baja', 'Desistió'] as const) for (const turno of ['AM', 'PM'] as const) {
    const origin = { ...mark('origin', turno, status), dia: 3 };
    const plan = planShiftContinuations([], [origin], (day) => `2026-11-${day + 15}`);
    assert.equal(plan.writes.length, turno === 'AM' ? 6 : 5);
    assert.ok(plan.writes.every((r) => r.dia >= 3 && r.dia <= 5 && r.estado_asistencia === status));
    assert.equal(plan.writes.some((r) => r.dia === 3 && r.turno === 'PM'), true);
    assert.equal(plan.writes.filter((r) => r.propagado_desde === 'origin').length, plan.writes.length - 1);
  }
});

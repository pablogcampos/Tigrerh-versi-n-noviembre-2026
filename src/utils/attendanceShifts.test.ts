import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attendanceShiftId, attendanceShiftView, dailyAttendance, dropoutShiftCounts, shiftAttendanceColumns } from './attendanceShifts';
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
test('exports use only ten shift columns, with timestamp and origin inside each cell', () => {
  const result = shiftAttendanceColumns([mark('old', undefined, 'Feriado'), mark('am', 'AM'), mark('pm', 'PM', 'Faltó')], 's', 'p');
  assert.match(result['Día 5 AM'], /^Asistió.*16\/11\/2026.*10:00:00/);
  assert.match(result['Día 5 PM'], /^Faltó/);
  assert.equal(Object.keys(result).length, 10);
  const legacy = shiftAttendanceColumns([mark('old', undefined, 'Feriado')], 's', 'p');
  assert.match(legacy['Día 5 AM'], /^Sin turno: Feriado/);
  assert.match(legacy['Día 5 PM'], /^Sin turno: Feriado/);
  const automatic = shiftAttendanceColumns([{ ...mark('pm', 'PM', 'Baja'), propagado_desde: 'am' }], 's', 'p');
  assert.match(automatic['Día 5 PM'], /^Arrastre: Baja/);
});

test('legacy and pending dropout changes appear through D5 in either shift without mutating data', () => {
  for (const turno of [undefined, 'AM', 'PM'] as const) {
    const origin = { ...mark('origin', turno, 'Desistió'), dia: 2 };
    const records = [origin, { ...mark('empty', 'AM', 'Seleccionar'), dia: 4 }];
    const before = JSON.stringify(records);
    for (const shift of ['AM', 'PM'] as const) {
      const view = attendanceShiftView(records, 's', shift);
      for (let day = 3; day <= 5; day++) assert.equal(view.find((r) => r.dia === day)?.estado_asistencia, 'Desistió');
      assert.equal(view.some((r) => r.dia === 1), false);
    }
    assert.equal(JSON.stringify(records), before);
    assert.equal(attendanceShiftView(records, 'another', 'AM').length, 0);
  }
  const corrected = [mark('origin', 'AM'), { ...mark('auto', 'PM', 'Desistió'), propagado_desde: 'origin' }];
  assert.equal(attendanceShiftView(corrected, 's', 'PM').length, 0);
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

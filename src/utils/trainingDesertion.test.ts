import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePhaseMetrics } from '../../backend/src/services/trainingPhaseMetrics';

for (const finalDay of [5, 10] as const) {
  const records = [
    { participant_id: 'stays', dia: 1, estado_asistencia: 'Asistió' },
    { participant_id: 'stays', dia: 2, estado_asistencia: 'Asistió' },
    { participant_id: 'stays', dia: finalDay, estado_asistencia: 'Asistió' },
    { participant_id: 'leaves-before-d2', dia: 1, estado_asistencia: 'Asistió' },
    { participant_id: 'excluded', dia: 1, estado_asistencia: 'Tardanza' },
    { participant_id: 'excluded', dia: 2, estado_asistencia: 'Desistió' },
  ];
  const finalDays = new Map(records.map(record => [record.participant_id, finalDay]));

  test(`D${finalDay}: counts losses before D2 from the D1 base`, () => {
    const metrics = calculatePhaseMetrics(new Set(finalDays.keys()), records, [], finalDays);
    assert.equal(metrics.d1Ids.size, 3);
    assert.equal(metrics.d2Ids.size, 1);
    assert.equal(metrics.desercionesFinales, 2);
    assert.equal(metrics.desercionFinalRate, 67);
    assert.equal(metrics.altasFinalIds.size, 1);
  });

  test(`D${finalDay}: respects the participant scope after applying exclusions`, () => {
    const metrics = calculatePhaseMetrics(new Set(['stays', 'leaves-before-d2']), records, [], finalDays);
    assert.equal(metrics.d1Ids.size, 2);
    assert.equal(metrics.desercionesFinales, 1);
    assert.equal(metrics.desercionFinalRate, 50);
    assert.equal(metrics.altasFinalIds.size, 1);
    assert.equal(metrics.finalDayIds.has('excluded'), false);
  });
}

test('no D1 attendance returns zero without negative values or division by zero', () => {
  const metrics = calculatePhaseMetrics(new Set(['p']), [
    { participant_id: 'p', dia: 2, estado_asistencia: 'Asistió' },
    { participant_id: 'p', dia: 10, estado_asistencia: 'Asistió' },
  ], []);
  assert.equal(metrics.desercionesFinales, 0);
  assert.equal(metrics.desercionFinalRate, 0);
  assert.equal(metrics.altasFinalIds.size, 1);
});

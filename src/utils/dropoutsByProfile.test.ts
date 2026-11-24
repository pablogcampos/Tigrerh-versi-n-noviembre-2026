import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dropoutsByProfile } from './dropoutsByProfile';

const people = ['EJECUTIVO COMERCIAL', 'Ejecutivo Call-Center', 'Consultivo', 'CORPORATIVO', '', 'Supervisor']
  .map((puesto, i) => ({ id: String(i), training_session_id: 's', puesto }));
const mark = (id: string, dia: number, estado_asistencia = 'Desistió', training_session_id = 's') =>
  ({ participant_id: id, dia, estado_asistencia, training_session_id });

test('counts first dropout per profile, not repeated shifts or propagated days', () => {
  const records = [mark('0', 3), mark('0', 3), mark('0', 5), mark('0', 2, 'Baja'),
    mark('1', 1), mark('2', 4, 'BAJA'), mark('3', 5), mark('4', 2), mark('5', 3)];
  const before = JSON.stringify({ people, records });
  const result = dropoutsByProfile(people, records);
  assert.equal(result.reduce((n, row) => n + row.total, 0), 6);
  assert.equal(result.find((r) => r.name === 'Comercial')?.D2, 1);
  assert.equal(result.find((r) => r.name === 'Comercial')?.D3, 0);
  assert.equal(result.find((r) => r.name === 'Call center')?.D1, 1);
  assert.equal(result.find((r) => r.name === 'Consultivo')?.D4, 1);
  assert.equal(result.find((r) => r.name === 'Corporativo')?.D5, 1);
  assert.equal(result.find((r) => r.name === 'Sin perfil')?.D2, 1);
  assert.equal(result.find((r) => r.name === 'Otros')?.D3, 1);
  assert.equal(JSON.stringify({ people, records }), before);
});

test('honors participant exclusions and training scope; does not invent dropout from absences', () => {
  const records = [mark('0', 1), mark('1', 2, 'Faltó'), mark('1', 2, 'Baja', 'other'),
    mark('2', 6), mark('2', 0), mark('3', 5, 'Asistió')];
  const result = dropoutsByProfile(people.filter((p) => p.id !== '0'), records);
  assert.equal(result.reduce((n, row) => n + row.total, 0), 0);
  assert.equal(result.length, 4);
  assert.equal(dropoutsByProfile([], records).every((row) => row.total === 0), true);
});

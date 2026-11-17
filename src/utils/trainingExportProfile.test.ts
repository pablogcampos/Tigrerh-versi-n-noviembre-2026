import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { buildTrainingWorkbook, TRAINING_EXPORT_HEADERS } from './trainingExport';
import type { TrainingSession, Participant, AttendanceRecord } from '../types';

test('training export preserves recruiter profiles, filters, historical rows and existing columns', () => {
  const sessions = [{ id: 's', campaña: 'Culqi', generation_code: 'CAP-A' }] as TrainingSession[];
  const profiles = ['Ejecutivo call center', 'Consultivo', 'Corporativo', 'Comercial', '', undefined];
  const people = Array.from({ length: 105 }, (_, i) => ({
    id: `p${i}`, training_session_id: 's', nombres: `Person ${i}`, apellidos: 'Test',
    puesto: profiles[i % profiles.length], evaluacion_nota: 0,
  })) as Participant[];
  const excluded = { ...people[0], id: 'excluded', training_session_id: 'other', puesto: 'Excluded' };
  const attendance = [{ id: 'a', participant_id: 'p0', training_session_id: 's', dia: 5,
    estado_asistencia: 'Asistió', fecha_registro: '2026-10-15T15:00:00Z', turno: 'AM' },
    { id: 'b', participant_id: 'p0', training_session_id: 's', dia: 5,
      estado_asistencia: 'Desistió', fecha_registro: '2026-10-15T20:30:05Z', turno: 'PM' }] as AttendanceRecord[];
  const before = JSON.stringify({ people, attendance });
  const workbook = buildTrainingWorkbook(sessions, [], [...people, people[0], excluded], attendance, []);
  const reopened = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  assert.deepEqual(reopened.SheetNames, ['Postulantes']);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(reopened.Sheets.Postulantes, { defval: '' });
  const headers = XLSX.utils.sheet_to_json<unknown[]>(reopened.Sheets.Postulantes, { header: 1 })[0];
  assert.deepEqual(headers, TRAINING_EXPORT_HEADERS);
  assert.equal(headers.length, 18);
  assert.ok(headers.includes('Día 5 PM'));
  assert.equal(headers.at(-2), 'Nota del examen');
  assert.equal(headers.at(-1), 'Perfil del ejecutivo');
  assert.equal(rows.length, 105);
  for (let i = 0; i < people.length; i++) {
    assert.equal(rows[i]['Perfil del ejecutivo'], people[i].puesto ?? '');
    assert.equal(rows[i]['Nombre del postulante'], `Person ${i} Test`);
  }
  assert.match(String(rows[0]['Día 5 AM']), /^Asistió/);
  assert.match(String(rows[0]['Día 5 PM']), /^Desistió.*15\/10\/2026.*15:30:05/);
  assert.equal(rows[0]['Desistió (Sí/No)'], 'Sí');
  assert.equal(rows[0]['Nota del examen'], 0);
  assert.equal(JSON.stringify({ people, attendance }), before);
});

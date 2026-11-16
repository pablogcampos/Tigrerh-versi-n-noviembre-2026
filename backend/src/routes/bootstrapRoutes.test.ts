import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { dataDb } from '../hybridDb.js';
import { getPostgresPool, closePostgresPool } from '../postgres.js';

test('Attendance loads fresh summaries for both roles and evidence only on authorized demand', async (t) => {
  const firebase = initializeApp({ projectId: 'attendance-read-tests' });
  t.after(() => deleteApp(firebase));
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  t.after(async () => { await closePostgresPool(); if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl; });
  t.mock.method(getAuth(), 'verifyIdToken', async (uid: string) => ({ uid }) as any);
  const profiles: Record<string, any> = {
    admin: { rol: 'Administrador' }, trainer: { rol: 'Formador' }, outsider: { rol: 'Formador' },
  };
  const record = { id: 'a', training_session_id: 's', participant_id: 'p', dia: 1, estado_asistencia: 'Asistió', evidencia_imagen: 'data:image/png;base64,TEST', evidencia_nombre: 'test.png', motivo_desercion: 'Herramientas' };
  const collections: Record<string, any[]> = {
    users: [], sessions: [{ id: 's', formador_id: 'trainer', campaña: 'Culqi', training_days: 10, fecha_inicio: '2026-11-13' }, { id: 'eq', campaña: 'Equifax', formador_id: 'trainer' }],
    participants: [{ id: 'p', training_session_id: 's' }], attendance: [record],
  };
  const doc = (item: any) => ({ id: item?.id, exists: Boolean(item), data: () => item });
  let evidenceReads = 0;
  t.mock.method(dataDb, 'collection', (name: string): any => ({
    doc: (id: string) => ({ get: async () => {
      if (name === 'attendance') evidenceReads++;
      return doc(name === 'users' && profiles[id] ? { id, estado: 'Activo', ...profiles[id] } : collections[name]?.find(r => r.id === id));
    } }),
    get: async () => {
      assert.notEqual(name, 'attendance', 'bootstrap must not download embedded evidence');
      return { docs: (collections[name] || []).map(doc) };
    },
  }));
  let summaryReads = 0;
  t.mock.method(getPostgresPool(), 'query', async (sql: string) => {
    summaryReads++;
    assert.match(sql, /payload - 'evidencia_imagen'/);
    assert.match(sql, /NOT is_deleted/);
    const { evidencia_imagen, ...summary } = record;
    return { rows: [{ document_id: record.id, payload: { ...summary, evidencia_disponible: Boolean(evidencia_imagen) } }, { document_id: 'old-d10', payload: { ...summary, id: 'old-d10', dia: 10 } }, { document_id: 'eq-att', payload: { ...summary, id: 'eq-att', training_session_id: 'eq' } }] } as any;
  });
  const { bootstrapRoutes } = await import('./bootstrapRoutes.js');
  const app = express(); app.use('/bootstrap', bootstrapRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/bootstrap`;
  const request = (uid: string, path = '?scope=training') => fetch(base + path, { headers: uid ? { Authorization: `Bearer ${uid}` } : {} });
  const body = (response: Awaited<ReturnType<typeof fetch>>) => response.json() as Promise<{ sessions: Array<Record<string, unknown>>; attendance: Array<Record<string, unknown>>; evidencia_imagen?: string }>;
  assert.equal((await request('')).status, 401);
  for (const uid of ['admin', 'trainer']) {
    for (const path of ['', '?scope=training']) {
      const response = await request(uid, path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const data = await body(response);
      assert.equal(data.attendance.length, 1);
      assert.equal(data.sessions.length, 1);
      assert.equal(data.sessions[0].training_days, 5);
      assert.equal(data.sessions[0].fecha_fin, '2026-11-19');
      assert.equal(collections.sessions[0].training_days, 10);
      assert.equal(data.attendance[0].estado_asistencia, record.estado_asistencia);
      assert.equal(data.attendance[0].evidencia_imagen, undefined);
      assert.equal(data.attendance[0].evidencia_disponible, true);
      assert.equal(data.attendance[0].motivo_desercion, 'Herramientas');
    }
  }
  assert.equal(evidenceReads, 0);
  record.estado_asistencia = 'Tardanza';
  assert.equal((await body(await request('admin'))).attendance[0].estado_asistencia, 'Tardanza');
  assert.equal((await body(await request('trainer'))).attendance[0].estado_asistencia, 'Tardanza');
  assert.equal(summaryReads, 6);
  assert.deepEqual((await body(await request('outsider'))).attendance, []);
  assert.equal((await request('', '/attendance/a/evidence')).status, 401);
  assert.equal((await request('outsider', '/attendance/a/evidence')).status, 403);
  assert.equal((await request('admin', '/attendance/missing/evidence')).status, 404);
  for (const uid of ['admin', 'trainer']) {
    const response = await request(uid, '/attendance/a/evidence');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await body(response)).evidencia_imagen, record.evidencia_imagen);
  }
  assert.equal(record.evidencia_imagen, 'data:image/png;base64,TEST');
});

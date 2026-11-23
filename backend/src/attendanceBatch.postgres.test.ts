import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dataDb } from './hybridDb.js';
import { getPostgresPool, closePostgresPool } from './postgres.js';

// Opt-in: writes only to a session-local temporary table; never to application rows.
test('bulk transaction SQL: 400 reads, 40 writes, retry and rollback in a temporary table', {
  skip: process.env.ATTENDANCE_SQL_QA !== '1',
}, async (t) => {
  const pool = getPostgresPool();
  const db = await pool.connect();
  t.after(async () => { db.release(); await closePostgresPool(); });
  await db.query('CREATE TEMP TABLE attendance_batch_qa (LIKE tigre_rh.current_documents INCLUDING ALL)');
  let calls = 0;
  const proxy = {
    query: (sql: string, values?: unknown[]) => {
      calls++;
      return db.query(sql.replaceAll('tigre_rh.current_documents', 'pg_temp.attendance_batch_qa'), values);
    },
    release: () => {},
  };
  // Schema already exists; prevent the adapter bootstrap from issuing global DDL.
  t.mock.method(pool, 'query', async () => ({ rows: [] }) as any);
  t.mock.method(pool, 'connect', async () => proxy as any);
  const people = Array.from({ length: 40 }, (_, i) => dataDb.collection('participants').doc('qa-' + i));
  const marks = people.flatMap((p) => Array.from({ length: 10 }, (_, i) => dataDb.collection('attendance').doc(p.id + '-' + i)));
  const save = () => dataDb.runTransaction(async (tx) => {
    const participants = await tx.getAll(people);
    assert.equal(participants.length, 40);
    const previous = await tx.getAll(marks);
    assert.equal(previous.length, 400);
    tx.setAll(people.map((ref) => ({ ref, data: { id: ref.id, flag: 'preserved' } })));
    tx.setAll(marks.slice(0, 40).map((ref) => ({ ref, data: { id: ref.id, estado_asistencia: 'Asistió' } })));
  });
  const started = performance.now();
  await save();
  const duration = Math.round(performance.now() - started);
  assert.equal(calls, 8);
  await save();
  assert.equal((await db.query('SELECT count(*)::int AS n FROM pg_temp.attendance_batch_qa')).rows[0].n, 80);
  await assert.rejects(dataDb.runTransaction(async (tx) => {
    await tx.getAll([people[0]]);
    tx.setAll([{ ref: people[0], data: { id: people[0].id, flag: 'must rollback' } }]);
    await tx.flush();
    throw new Error('forced rollback');
  }), /forced rollback/);
  assert.equal((await db.query("SELECT payload->>'flag' AS flag FROM pg_temp.attendance_batch_qa WHERE collection_name='participants' LIMIT 1")).rows[0].flag, 'preserved');
  console.log(`Batch SQL verified in ${duration} ms; 400 slots, 40 participants; no real rows changed`);
});

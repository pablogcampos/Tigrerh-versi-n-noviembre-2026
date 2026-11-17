import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { dataDb } from '../hybridDb.js';
import { getScheduledTrainingDays, getInitialTrainingEndDate, hasCampaignOjt, isHiddenFormationCampaign, isDayFiveSurveyEligible } from './trainingSchedule.js';
import { getSessionFinalTrainingDay, calculatePhaseMetrics } from './trainingPhaseMetrics.js';
import { ensureDayFiveOjtSurvey } from './surveyAutomationService.js';

test('all operational campaigns close on D5, preserving historical source values', () => {
  for (const campaña of ['Culqi', 'Entel Empresas RUC 10', 'Entel Empresas RUC 20', 'GPON']) {
    const original = { campaña, training_days: 10, ojt_module_id: 'historic' };
    assert.equal(getScheduledTrainingDays(campaña), 5);
    assert.equal(getSessionFinalTrainingDay(original), 5);
    assert.equal(hasCampaignOjt(campaña), false);
    assert.equal(isHiddenFormationCampaign(campaña), false);
    assert.equal(original.training_days, 10);
    assert.equal(original.ojt_module_id, 'historic');
  }
  assert.equal(isHiddenFormationCampaign('Equifax'), true);
  assert.equal(isHiddenFormationCampaign('Fija'), true);
  assert.equal(getInitialTrainingEndDate('2026-11-13'), '2026-11-19');
  const records = [
    { participant_id: 'p', dia: 1, estado_asistencia: 'Asistió' },
    { participant_id: 'q', dia: 1, estado_asistencia: 'Asistió' },
    { participant_id: 'p', dia: 5, estado_asistencia: 'Asistió' },
    { participant_id: 'q', dia: 10, estado_asistencia: 'Asistió' },
  ];
  const metrics = calculatePhaseMetrics(new Set(['p', 'q']), records, []);
  assert.deepEqual([...metrics.altasFinalIds], ['p']);
  assert.equal(metrics.desercionFinalRate, 50);
});

test('D5 survey requires Apto and attendance in the same training', () => {
  const participant = { id: 'p', training_session_id: 's', resultado_formacion: 'Apto' };
  const day = { participant_id: 'p', training_session_id: 's', dia: 5, estado_asistencia: 'Asistió' };
  assert.equal(isDayFiveSurveyEligible(participant, [day]), true);
  for (const estado_asistencia of ['Seleccionar', 'Faltó', 'Baja', 'Desistió']) {
    assert.equal(isDayFiveSurveyEligible(participant, [{ ...day, estado_asistencia }]), false);
  }
  assert.equal(isDayFiveSurveyEligible({ ...participant, resultado_formacion: 'No apto' }, [day]), false);
  assert.equal(isDayFiveSurveyEligible(participant, [{ ...day, training_session_id: 'other' }]), false);
  assert.equal(isDayFiveSurveyEligible(participant, [{ ...day, dia: 4 }]), false);
});

test('five-day API flow, idempotency, manual control and legacy preservation', async (t) => {
  type Data = Record<string, any>;
  const store: Record<string, Map<string, Data>> = {};
  const rows = (name: string) => store[name] ||= new Map();
  const collection = (name: string) => {
    const values = rows(name);
    const doc = (id: string): any => ({
      id, get: async () => ({ id, exists: values.has(id), data: () => values.get(id) || {} }),
      create: async (data: Data) => {
        if (values.has(id)) throw Object.assign(new Error('Duplicate'), { code: 6 });
        values.set(id, structuredClone(data));
      },
      set: async (data: Data, options?: { merge?: boolean }) => values.set(id, { ...(options?.merge ? values.get(id) : {}), ...data }),
    });
    const query = (filters: Array<[string, unknown]> = []): any => ({
      doc, where: (key: string, _op: string, value: unknown) => query([...filters, [key, value]]),
      limit: () => query(filters),
      get: async () => ({ docs: await Promise.all([...values.keys()].filter((id) => filters.every(([key, value]) => values.get(id)?.[key] === value)).map((id) => doc(id).get())) }),
    });
    return query();
  };
  t.mock.method(dataDb, 'collection', collection);
  t.mock.method(dataDb, 'bulkWriter', () => ({
    set: (ref: any, data: Data, options: any) => ref.set(data, options), close: async () => {},
  }) as any);
  let failCommit = false;
  t.mock.method(dataDb, 'runTransaction', async (callback: any) => {
    const writes: Array<() => Promise<unknown>> = [];
    const result = await callback({ get: (ref: any) => ref.get(),
      set: (ref: any, data: Data, options: any) => writes.push(() => ref.set(data, options)) });
    if (failCommit) throw new Error('Commit unavailable');
    for (const write of writes) await write();
    return result;
  });
  const require = createRequire(new URL('../../package.json', import.meta.url));
  const { initializeApp, deleteApp } = require('firebase-admin/app');
  const app = initializeApp({ projectId: 'five-day-isolated-test' });
  try {
    const { operationRoutes } = await import('../routes/operationRoutes.js');
    const { publicSurveyRoutes } = await import('../routes/publicSurveyRoutes.js');
    const { surveyRoutes } = await import('../routes/surveyRoutes.js');
    const invoke = async (router: any, path: string, method: string, request: Data = {}) => {
      const handler = router.stack.find((layer: any) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
      let code = 200; let payload: any;
      const res: any = { status: (v: number) => { code = v; return res; }, json: (v: any) => { payload = v; return res; }, set: () => res };
      await handler({ user: { uid: 'admin', rol: 'Administrador', module_view_only: [] }, params: {}, query: {}, ...request }, res);
      return { code, payload };
    };
    const session = { id: 's', campaña: 'Culqi', training_days: 10, training_model: 'split_ojt', ojt_module_id: 'old', formador_id: 'trainer' };
    const participant = { id: 'p', training_session_id: 's', dni: '00123456', resultado_formacion: 'Apto', evaluacion_nota: 16 };
    const day = { id: 'day5', participant_id: 'p', training_session_id: 's', dia: 5, estado_asistencia: 'Asistió' };
    rows('sessions').set('s', session);
    rows('participants').set('p', participant);
    rows('attendance').set('day5', day);
    rows('attendance').set('historical', { ...day, id: 'historical', dia: 10, estado_asistencia: 'Baja', evidencia_imagen: 'preserve' });
    rows('ojt_modules').set('old', { id: 'old', participant_ids: ['p'], generation_ids: ['s'] });
    rows('surveys').set('legacy', { id: 'legacy', survey_type: 'ojt', ojt_module_id: 'old' });
    rows('responses').set('legacy-answer', { id: 'legacy-answer', training_survey_id: 'legacy', participant_id: 'p', q1: 5 });
    const historical = structuredClone(rows('attendance').get('historical'));
    const originalSession = structuredClone(session);

    await t.test('one new survey per training, no group or historical writes', async () => {
      const result = await invoke(operationRoutes, '/participants/:id', 'put', { params: { id: 'p' }, body: participant });
      assert.equal(result.code, 200);
      const survey = rows('surveys').get('srv-ojt-training-s')!;
      assert.equal(survey.estado, 'Habilitada');
      assert.equal(survey.training_session_id, 's');
      assert.equal(survey.ojt_module_id, undefined);
      await ensureDayFiveOjtSurvey(session, [participant], [day]);
      assert.equal(rows('surveys').size, 2);
      assert.deepEqual(rows('attendance').get('historical'), historical);
      assert.deepEqual(rows('sessions').get('s'), originalSession);
      assert.equal(rows('attendance').size, 2);
      assert.equal(rows('responses').get('legacy-answer')?.q1, 5);
    });
    await t.test('D5 confirmation and disabled D6 writes', async () => {
      const confirmation = await invoke(operationRoutes, '/confirmations/:id', 'put', { params: { id: 'c' }, body: { training_session_id: 's', participant_id: 'p', estado_alta: 'Alta confirmada' } });
      assert.equal(confirmation.code, 200);
      rows('participants').set('p', { ...participant, resultado_formacion: 'No apto' });
      const denied = await invoke(operationRoutes, '/confirmations/:id', 'put', { params: { id: 'c2' }, body: { training_session_id: 's', participant_id: 'p', estado_alta: 'Alta confirmada' } });
      assert.equal(denied.code, 409);
      const d6 = await invoke(operationRoutes, '/attendance/:id', 'put', { params: { id: 'day6' }, body: { ...day, dia: 6 } });
      assert.equal(d6.code, 403);
      assert.equal(rows('attendance').has('day6'), false);
      rows('participants').set('p', participant);
    });
    await t.test('public D5 survey validates individual eligibility and blocks duplicate answers', async () => {
      const survey = rows('surveys').get('srv-ojt-training-s')!;
      const request = { params: { token: survey.token }, query: { dni: participant.dni } };
      const valid = await invoke(publicSurveyRoutes, '/:token', 'get', request);
      assert.equal(valid.code, 200);
      assert.equal(valid.payload.survey.codigo_generacion, 's');
      assert.equal(valid.payload.survey.formador_id, 'trainer');
      rows('participants').set('p', { ...participant, resultado_formacion: 'No apto' });
      assert.equal((await invoke(publicSurveyRoutes, '/:token', 'get', request)).code, 404);
      rows('participants').set('p', participant);
      const body = { dni: participant.dni, q1: 5, q2: 5, q3: 5, q4: 5, q5: 5, q6: 5, q7: 5, q8: 5 };
      assert.equal((await invoke(publicSurveyRoutes, '/:token/responses', 'post', { ...request, body })).code, 201);
      assert.equal((await invoke(publicSurveyRoutes, '/:token/responses', 'post', { ...request, body })).code, 409);
    });
    await t.test('AM and PM persist independently; retries are idempotent and unauthorized writes fail', async () => {
      const shift = (turno: string, estado_asistencia: string) => ({ ...day, id: 'client-id', turno, estado_asistencia });
      const send = (record: Data, user?: Data) => invoke(operationRoutes, '/attendance/bulk', 'put', { body: { records: [record] }, ...(user ? { user } : {}) });
      const trainer = { uid: 'trainer', rol: 'Formador', module_view_only: [] };
      // Existing access window is preserved; admin is used for deterministic off-hours tests.
      assert.equal((await send(shift('AM', 'Asistió'))).code, 200);
      assert.equal((await send(shift('PM', 'Faltó'))).code, 200);
      const amId = 'att-shift-s-p-5-AM', pmId = 'att-shift-s-p-5-PM';
      assert.equal(rows('attendance').get(amId)?.estado_asistencia, 'Asistió');
      assert.equal(rows('attendance').get(pmId)?.estado_asistencia, 'Faltó');
      const count = rows('attendance').size;
      assert.equal((await send(shift('AM', 'Asistió'))).payload.saved, 1);
      assert.equal(rows('attendance').size, count);
      assert.equal(isDayFiveSurveyEligible(participant, [...rows('attendance').values()]), true);
      assert.deepEqual(rows('attendance').get('historical'), historical);
      const denied = await send(shift('PM', 'Baja'), { ...trainer, uid: 'outsider' });
      assert.equal(denied.code, 403);
      assert.equal(rows('attendance').get(pmId)?.estado_asistencia, 'Faltó');
      failCommit = true;
      assert.equal((await send(shift('PM', 'Baja'))).code, 503);
      assert.equal(rows('attendance').get(pmId)?.estado_asistencia, 'Faltó');
      failCommit = false;
      rows('attendance').delete(amId); rows('attendance').delete(pmId);
    });
    await t.test('AM/PM dropout propagates atomically to D5 and correction clears only its automatic marks', async () => {
      const p = { ...participant, id: 'dropout' };
      rows('participants').set(p.id, p);
      rows('sessions').set('s', { ...session, fecha_inicio: '2026-11-13' });
      const send = (estado_asistencia: string, turno = 'PM') => invoke(operationRoutes, '/attendance/bulk', 'put',
        { body: { records: [{ ...day, id: 'client', participant_id: p.id, dia: 2, turno, estado_asistencia,
          motivo_desercion: estado_asistencia === 'Baja' ? 'Herramientas' : '' }] } });
      const baseId = 'att-shift-s-dropout-2-PM';
      const before = { ...day, id: 'att-shift-s-dropout-2-AM', participant_id: p.id, dia: 2, turno: 'AM' };
      rows('attendance').set(before.id, before);
      const saved = await send('Baja');
      assert.equal(saved.code, 200);
      assert.equal(saved.payload.saved, 1);
      assert.equal(saved.payload.records.length, 7);
      assert.equal(rows('participants').get(p.id)?.estado_final, 'Desistió');
      assert.deepEqual(rows('attendance').get(before.id), before);
      for (let dia = 3; dia <= 5; dia++) for (const turno of ['AM', 'PM']) {
        const record = rows('attendance').get(`att-shift-s-dropout-${dia}-${turno}`)!;
        assert.equal(record.estado_asistencia, 'Baja');
        assert.equal(record.propagado_desde, baseId);
        assert.equal(record.motivo_desercion, 'Herramientas');
        assert.equal(record.fecha_registro, rows('attendance').get(baseId)?.fecha_registro);
      }
      assert.equal(rows('attendance').get('att-shift-s-dropout-5-AM')?.fecha, '2026-11-19');
      const size = rows('attendance').size;
      await send('Baja');
      assert.equal(rows('attendance').size, size);
      failCommit = true;
      assert.equal((await send('Asistió')).code, 503);
      assert.equal(rows('attendance').get('att-shift-s-dropout-5-PM')?.estado_asistencia, 'Baja');
      failCommit = false;
      await send('Asistió');
      assert.equal(rows('attendance').get('att-shift-s-dropout-5-PM')?.estado_asistencia, 'Seleccionar');
      assert.equal(rows('participants').get(p.id)?.estado_final, 'En formación');
      await send('Desistió', 'AM');
      assert.equal(rows('attendance').get('att-shift-s-dropout-3-AM')?.estado_asistencia, 'Desistió');
      // A separately recorded mark is preserved, even when the earlier terminal state remains effective.
      assert.equal(rows('attendance').get(baseId)?.estado_asistencia, 'Asistió');
      assert.equal(isDayFiveSurveyEligible(p, [...rows('attendance').values()]), false);
      assert.deepEqual(rows('attendance').get('historical'), historical);
    });
    await t.test('manual disabling survives synchronization; early enabling is rejected', async () => {
      const survey = rows('surveys').get('srv-ojt-training-s')!;
      const request = { params: { surveyId: survey.id }, body: { status: 'Deshabilitada' } };
      assert.equal((await invoke(surveyRoutes, '/:surveyId/status', 'patch', request)).code, 200);
      await ensureDayFiveOjtSurvey(session, [participant], [day]);
      assert.equal(rows('surveys').get(survey.id)?.estado, 'Deshabilitada');
      rows('attendance').delete('day5');
      assert.equal((await invoke(surveyRoutes, '/:surveyId/status', 'patch', { ...request, body: { status: 'Habilitada' } })).code, 409);
    });
  } finally {
    await deleteApp(app);
  }
});

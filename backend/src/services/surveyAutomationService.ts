import { randomUUID } from 'node:crypto';
import { dataDb as adminDb } from '../hybridDb.js';
import { hasLegacyCampaignOjt as hasCampaignOjt, isDayFiveSurveyEligible, isHiddenFormationCampaign } from './trainingSchedule.js';

type RecordData = Record<string, any>;

export const OJT_MINIMUM_FINAL_SCORE = 16;

export const isEligibleForOjt = (participant: RecordData) =>
  Number(participant.evaluacion_nota) >= OJT_MINIMUM_FINAL_SCORE;

const cleanToken = (value: unknown) => String(value || '').trim().replace(/\s+/g, '-').toUpperCase();
const uniqueText = (values: unknown[]) => [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];

const operationSupervisors = (campaign: string) => {
  const normalized = campaign.trim().toLowerCase();
  if (normalized === 'culqi') return ['Augusto Tello', 'Jerson Atoche', 'Romey Huiman', 'Johnny Weill', 'Christian Delgado', 'Rosel Guevara'];
  if (normalized === 'equifax') return ['Juan Rondon', 'Hugo Navarro'];
  if (normalized.includes('ruc 20')) return ['Matias Canicela', 'Katya Laiche'];
  if (normalized.includes('ruc 10')) return ['Janeth Coronado'];
  if (normalized.includes('entel')) return ['Rosel Guevara', 'Estefano Zambrano'];
  return [];
};

const createIfMissing = async (collection: string, id: string, value: RecordData) => {
  try {
    await adminDb.collection(collection).doc(id).create(value);
    return value;
  } catch (error) {
    if ((error as { code?: number }).code !== 6) throw error;
    const existing = await adminDb.collection(collection).doc(id).get();
    return existing.data();
  }
};

export const buildInitialSurvey = (session: RecordData, createdById = '') => {
  const id = `srv-initial-${session.id}`;
  const code = String(session.generation_code || session.nombre_generacion || session.id);
  return {
    id,
    training_session_id: session.id,
    codigo_generacion: code,
    campaña: String(session.campaña || ''),
    formador_id: String(session.formador_id || ''),
    formador_nombre: String(session.formador_nombre || ''),
    estado: 'Deshabilitada',
    token: cleanToken(`INI-${code}`),
    survey_type: 'inicial',
    automatico: true,
    created_by_id: createdById,
    created_at: new Date().toISOString(),
  };
};

export const ensureInitialSurvey = async (session: RecordData, createdById = '') =>
  createIfMissing('surveys', `srv-initial-${session.id}`, buildInitialSurvey(session, createdById));

export const buildDayFiveOjtSurvey = (session: RecordData, createdById = '') => ({
  ...buildInitialSurvey(session, createdById),
  id: `srv-ojt-training-${session.id}`,
  token: cleanToken(`OJT-TRAINING-${session.id}`),
  survey_type: 'ojt',
  estado: 'Habilitada',
});

export const ensureDayFiveOjtSurvey = async (
  session: RecordData, participants: RecordData[], attendance: RecordData[], createdById = '',
) => {
  if (isHiddenFormationCampaign(session.campaña) || !participants.some((participant) =>
    participant.training_session_id === session.id && isDayFiveSurveyEligible(participant, attendance))) return null;
  const existing = await adminDb.collection('surveys').where('training_session_id', '==', session.id).get();
  const trainingSurvey = existing.docs.find((doc) => doc.data().survey_type === 'ojt' && !doc.data().ojt_module_id);
  if (trainingSurvey) return trainingSurvey.data();
  const survey = buildDayFiveOjtSurvey(session, createdById);
  // Never override a manually disabled link or a previously created survey.
  return createIfMissing('surveys', survey.id, survey);
};

export const buildOjtSurvey = (session: RecordData, module: RecordData, createdById = '') => {
  const id = `srv-ojt-${module.id}`;
  const groupName = String(module.nombre || module.id);
  const generationCodes = uniqueText([...(Array.isArray(module.generation_codes) ? module.generation_codes : []), session.generation_code, session.nombre_generacion]);
  const campaigns = uniqueText([...(Array.isArray(module.grupo_campañas) ? module.grupo_campañas : []), session.campaña]);
  return {
    id,
    training_session_id: '',
    ojt_module_id: String(module.id),
    grupo_ojt: groupName,
    grupo_generaciones: generationCodes,
    grupo_campañas: campaigns,
    codigo_generacion: groupName,
    campaña: campaigns.join(', '),
    formador_id: String((module.formador_ojt_ids || [])[0] || ''),
    formador_nombre: Array.isArray(module.formador_ojt_nombres) ? module.formador_ojt_nombres.join(', ') : '',
    estado: 'Deshabilitada',
    token: cleanToken(`OJT-${module.id}`),
    survey_type: 'ojt',
    automatico: true,
    created_by_id: createdById,
    created_at: new Date().toISOString(),
  };
};

export const ensureOjtSurvey = async (session: RecordData, module: RecordData, createdById = '') => {
  if (!hasCampaignOjt(session.campaña) || !module?.id) return null;
  const survey = buildOjtSurvey(session, module, createdById);
  const ref = adminDb.collection('surveys').doc(survey.id);
  const existing = await ref.get();
  if (!existing.exists) {
    await ref.create(survey);
    return survey;
  }
  const current = existing.data() || {};
  const grupo_generaciones = uniqueText([...(Array.isArray(current.grupo_generaciones) ? current.grupo_generaciones : []), ...survey.grupo_generaciones]);
  const grupo_campañas = uniqueText([...(Array.isArray(current.grupo_campañas) ? current.grupo_campañas : []), ...survey.grupo_campañas]);
  const synchronized = {
    ...survey,
    ...current,
    training_session_id: '',
    ojt_module_id: survey.ojt_module_id,
    grupo_ojt: survey.grupo_ojt,
    grupo_generaciones,
    grupo_campañas,
    codigo_generacion: survey.codigo_generacion,
    campaña: grupo_campañas.join(', '),
    formador_id: survey.formador_id,
    formador_nombre: survey.formador_nombre,
  };
  await ref.set(synchronized, { merge: true });
  return synchronized;
};

export const OPERATIONS_SURVEY_ID = 'srv-operations-global';
export const buildOperationsSurvey = (
  session: RecordData,
  confirmationId: string,
  createdById = '',
) => {
  const id = OPERATIONS_SURVEY_ID;
  return {
    id,
    training_session_id: '',
    codigo_generacion: 'Encuesta general de Operaciones',
    campaña: 'Todas las campañas',
    formador_id: '',
    formador_nombre: '',
    supervisor_nombres: [],
    estado: 'Deshabilitada',
    token: `OPE-${randomUUID()}`.toUpperCase(),
    survey_type: 'operaciones',
    automatico: true,
    created_by_id: createdById,
    created_at: new Date().toISOString(),
  };
};

export const ensureOperationsSurvey = async (
  session: RecordData,
  confirmationId: string,
  createdById = '',
) => {
  const survey = buildOperationsSurvey(session, confirmationId, createdById);
  const existing = await adminDb.collection('surveys').doc(survey.id).get();
  if (existing.exists) return existing.data();
  const previous = await adminDb.collection('surveys').where('survey_type', '==', 'operaciones').get();
  if (previous.docs.some((doc) => doc.data().estado === 'Habilitada')) survey.estado = 'Habilitada';
  return createIfMissing('surveys', survey.id, survey);
};

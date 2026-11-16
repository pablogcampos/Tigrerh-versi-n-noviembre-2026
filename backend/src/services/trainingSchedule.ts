const campaignKey = (campaign: unknown) => String(campaign || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const isHiddenFormationCampaign = (campaign: unknown) => ['equifax', 'fija'].includes(campaignKey(campaign));
export const isInitialOnlyCampaign = (_campaign: unknown) => true;

export const hasLegacyCampaignOjt = (campaign: unknown) =>
  ['entelempresasruc10', 'entelempresasruc20', 'entelruc10', 'entelruc20', 'ruc10', 'ruc20', 'culqi', 'tigreacademy'].includes(campaignKey(campaign));

export const hasCampaignOjt = (_campaign: unknown) => false;
export const getScheduledTrainingDays = (_campaign: unknown): 5 | 10 => 5;

export const isDayFiveSurveyEligible = (
  participant: { id?: unknown; training_session_id?: unknown; resultado_formacion?: unknown },
  attendance: Array<{ participant_id?: unknown; training_session_id?: unknown; dia?: unknown; estado_asistencia?: unknown }>,
) => participant.resultado_formacion === 'Apto' && attendance.some((record) =>
  record.participant_id === participant.id && record.training_session_id === participant.training_session_id &&
  Number(record.dia) === 5 && record.estado_asistencia === 'Asistió');

export const isBusinessDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && ![0, 6].includes(date.getUTCDay());
};

export const isInitialAttendanceComplete = (
  sessionId: string,
  participants: Array<{ id: string; estado_final?: unknown }>,
  records: Array<{ participant_id: string; training_session_id: string; dia: number; estado_asistencia: string }>,
) => participants.length > 0 && participants.every((participant) => {
  if (participant.estado_final === 'Desistió') return true;
  const attendance = records.filter((record) => record.participant_id === participant.id && record.training_session_id === sessionId);
  return [1, 2, 3, 4, 5].every((day) => attendance.some((record) =>
    (Number(record.dia) === day && ['Asistió', 'Tardanza', 'Faltó', 'Descanso médico', 'Feriado', 'Desistió', 'Baja'].includes(record.estado_asistencia)) ||
    (Number(record.dia) < day && ['Desistió', 'Baja'].includes(record.estado_asistencia))));
});
export const getInitialTrainingEndDate = (start: unknown) => {
  const date = new Date(`${String(start || '')}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(start || '');
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  for (let day = 1; day < 5;) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (![0, 6].includes(date.getUTCDay())) day++;
  }
  return date.toISOString().slice(0, 10);
};

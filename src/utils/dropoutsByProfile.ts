import type { AttendanceRecord, Participant } from '../types';

const normalize = (value: unknown) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const profileName = (value: string) => {
  const text = normalize(value).replace(/[-_]/g, ' ');
  if (/call\s*center/.test(text)) return 'Call center';
  if (text.includes('consultiv')) return 'Consultivo';
  if (text.includes('corporativ')) return 'Corporativo';
  if (text.includes('comercial')) return 'Comercial';
  return text ? 'Otros' : 'Sin perfil';
};

export const dropoutsByProfile = (
  participants: Pick<Participant, 'id' | 'training_session_id' | 'puesto'>[],
  attendance: Array<Pick<AttendanceRecord, 'participant_id' | 'training_session_id' | 'dia'> & { estado_asistencia: string }>,
) => {
  const people = new Map(participants.map((p) => [JSON.stringify([p.training_session_id, p.id]), p]));
  const firstDay = new Map<string, number>();
  for (const record of attendance) {
    const day = Number(record.dia);
    const key = JSON.stringify([record.training_session_id, record.participant_id]);
    if (!people.has(key) || !Number.isInteger(day) || day < 1 || day > 5 ||
      !['baja', 'desistio'].includes(normalize(record.estado_asistencia))) continue;
    firstDay.set(key, Math.min(firstDay.get(key) ?? 6, day));
  }
  const rows = new Map<string, { name: string; D1: number; D2: number; D3: number; D4: number; D5: number; total: number }>();
  const row = (name: string) => {
    if (!rows.has(name)) rows.set(name, { name, D1: 0, D2: 0, D3: 0, D4: 0, D5: 0, total: 0 });
    return rows.get(name)!;
  };
  ['Comercial', 'Call center', 'Consultivo', 'Corporativo'].forEach(row);
  for (const [key, day] of firstDay) {
    const entry = row(profileName(people.get(key)!.puesto || ''));
    entry[`D${day}` as 'D1' | 'D2' | 'D3' | 'D4' | 'D5']++;
    entry.total++;
  }
  return [...rows.values()];
};

import type { AttendanceRecord } from '../types';

export const attendanceShiftId = (sessionId: string, participantId: string, day: number, shift: 'AM' | 'PM') =>
  `att-shift-${encodeURIComponent(sessionId)}-${encodeURIComponent(participantId)}-${day}-${shift}`;

const marked = (record: AttendanceRecord) => !['Seleccionar', 'Pendiente', ''].includes(record.estado_asistencia);
const rank = (record: AttendanceRecord) => ['Baja', 'Desistió'].includes(record.estado_asistencia) ? 4
  : ['Asistió', 'Tardanza', 'Feriado'].includes(record.estado_asistencia) ? 3 : marked(record) ? 1 : 0;

// One daily outcome for legacy consumers. Either shift can satisfy attendance.
export const dailyAttendance = (records: AttendanceRecord[]) => {
  const groups = new Map<string, AttendanceRecord[]>();
  for (const record of records) {
    const key = JSON.stringify([record.training_session_id, record.participant_id, record.dia]);
    groups.set(key, [...(groups.get(key) || []), record]);
  }
  return [...groups.values()].map((group) => {
    const shifts = group.filter((record) => record.turno && marked(record));
    return [...(shifts.length ? shifts : group)].sort((a, b) => rank(b) - rank(a) ||
      String(b.fecha_registro).localeCompare(String(a.fecha_registro)))[0];
  });
};

const registrationFormatter = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const isDropout = (record?: AttendanceRecord) => ['Baja', 'Desistió'].includes(record?.estado_asistencia || '');

// Preserve daily legacy marks as fallbacks, without inventing an AM/PM assignment.
// These are display records only: original attendance and timestamps are not rewritten.
export const attendanceShiftView = (records: AttendanceRecord[], sessionId: string, turno: 'AM' | 'PM') => {
  const scoped = records.filter((r) => r.training_session_id === sessionId && r.dia >= 1 && r.dia <= 5);
  const byId = new Map(scoped.map((r) => [r.id, r]));
  const current = scoped.filter((r) => !r.propagado_desde || !byId.has(r.propagado_desde) || isDropout(byId.get(r.propagado_desde)));
  const people = new Map<string, AttendanceRecord[]>();
  for (const record of current) {
    const group = people.get(record.participant_id) || [];
    group.push(record); people.set(record.participant_id, group);
  }
  const order = (r: AttendanceRecord) => r.dia * 2 + (r.turno === 'PM' ? 1 : 0);
  const result: AttendanceRecord[] = [];
  for (const [participantId, group] of people) {
    const origins = group.filter(isDropout).sort((a, b) => order(a) - order(b));
    for (let dia = 1; dia <= 5; dia++) {
      const direct = group.filter((r) => Number(r.dia) === dia && r.turno === turno)
        .sort((a, b) => String(b.fecha_registro).localeCompare(String(a.fecha_registro)) ||
          Number(marked(b)) - Number(marked(a)))[0];
      const legacy = group.filter((r) => Number(r.dia) === dia && !r.turno && marked(r))
        .sort((a, b) => String(b.fecha_registro).localeCompare(String(a.fecha_registro)))[0];
      const origin = origins.find((r) => order(r) <= dia * 2 + (turno === 'PM' ? 1 : 0));
      if (direct && marked(direct)) result.push(direct);
      else if (origin) result.push({ ...origin,
        dia, turno, propagado_desde: origin.propagado_desde || origin.id });
      else if (legacy) result.push({ ...legacy, dia });
      else if (direct) result.push(direct);
    }
  }
  return result;
};

export const shiftAttendanceColumns = (records: AttendanceRecord[], sessionId: string, participantId: string) => {
  const result: Record<string, string> = {};
  const scoped = records.filter((r) => r.training_session_id === sessionId && r.participant_id === participantId);
  const views = { AM: attendanceShiftView(scoped, sessionId, 'AM'), PM: attendanceShiftView(scoped, sessionId, 'PM') };
  for (let day = 1; day <= 5; day++) for (const shift of ['AM', 'PM'] as const) {
    const projected = views[shift].find((r) => r.dia === day);
    const legacy = scoped.filter((r) => r.dia === day && !r.turno && marked(r))
      .sort((a, b) => String(b.fecha_registro).localeCompare(String(a.fecha_registro)))[0];
    const record = projected && marked(projected) ? projected : legacy;
    const registered = new Date(record?.fecha_registro || '');
    const timestamp = Number.isNaN(registered.getTime()) ? '' : registrationFormatter.format(registered);
    const prefix = record?.propagado_desde ? 'Arrastre: ' : record && !record.turno ? 'Registro diario: ' : '';
    result[`Día ${day} ${shift}`] = record ? `${prefix}${record.estado_asistencia}${timestamp ? ' | ' + timestamp : ''}` : '';
  }
  return result;
};

export const dropoutShiftCounts = (records: AttendanceRecord[]) => {
  const first = new Map<string, AttendanceRecord>();
  const order = (r: AttendanceRecord) => r.dia * 3 + (r.turno === 'PM' ? 2 : r.turno === 'AM' ? 1 : 0);
  for (const record of [...records].sort((a, b) => order(a) - order(b))) {
    if (!['Baja', 'Desistió'].includes(record.estado_asistencia)) continue;
    const key = JSON.stringify([record.training_session_id, record.participant_id]);
    if (!first.has(key)) first.set(key, record);
  }
  return ['AM', 'PM', 'Sin turno registrado'].map((name) => ({
    name, cantidad: [...first.values()].filter((r) => (r.turno || 'Sin turno registrado') === name).length,
  }));
};

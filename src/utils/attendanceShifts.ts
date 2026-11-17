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
export const shiftAttendanceColumns = (records: AttendanceRecord[], sessionId: string, participantId: string) => {
  const result: Record<string, string> = {};
  for (let day = 1; day <= 5; day++) for (const shift of ['AM', 'PM', 'Sin turno'] as const) {
    const record = records.filter((r) => r.training_session_id === sessionId && r.participant_id === participantId &&
      r.dia === day && (r.turno || 'Sin turno') === shift)
      .sort((a, b) => String(b.fecha_registro).localeCompare(String(a.fecha_registro)))[0];
    result[`Día ${day} ${shift}`] = record?.estado_asistencia || '';
    const registered = new Date(record?.fecha_registro || '');
    result[`Día ${day} ${shift} - Registro (Perú)`] = Number.isNaN(registered.getTime()) ? '' :
      registrationFormatter.format(registered);
    result[`Día ${day} ${shift} - Origen`] = record?.propagado_desde ? 'Propagado automáticamente' : record ? 'Registro directo' : '';
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

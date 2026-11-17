type Mark = Record<string, any>;
export const shiftId = (session: string, participant: string, day: number, shift: string) =>
  `att-shift-${encodeURIComponent(session)}-${encodeURIComponent(participant)}-${day}-${shift}`;
const dropout = (record?: Mark) => ['Baja', 'Desistió'].includes(record?.estado_asistencia);
const pending = (record?: Mark) => !record || ['', 'Seleccionar', 'Pendiente'].includes(record.estado_asistencia);
const order = (record: Mark) => Number(record.dia) * 2 + (record.turno === 'PM' ? 1 : 0);

// Rebuild only automatic continuations; preserve independent marks and past history.
export const planShiftContinuations = (
  previous: Mark[], input: Mark[], dateForDay: (day: number) => string,
) => {
  const records = new Map(previous.map((record) => [record.id, record]));
  const writes = new Map<string, Mark>();
  for (const record of input) {
    const manual = { ...record, propagado_desde: '' };
    records.set(record.id, manual);
    writes.set(record.id, manual);
  }
  for (const record of records.values()) {
    if (!record.propagado_desde) continue;
    const cleared = { ...record, estado_asistencia: 'Seleccionar', propagado_desde: '',
      motivo_desercion: '', observacion: '', evidencia_nombre: '', evidencia_imagen: '',
      evidencia_disponible: false, fecha_registro: '', registrado_por: '' };
    records.set(record.id, cleared);
    writes.set(record.id, cleared);
  }
  const origin = [...records.values()].filter(dropout).sort((a, b) => order(a) - order(b))[0];
  if (origin) {
    for (let day = Number(origin.dia); day <= 5; day++) for (const turno of ['AM', 'PM']) {
      if (day * 2 + (turno === 'PM' ? 1 : 0) <= order(origin)) continue;
      const id = shiftId(origin.training_session_id, origin.participant_id, day, turno);
      if (!pending(records.get(id))) continue;
      const continuation = { ...origin, id, dia: day, turno, fecha: dateForDay(day),
        propagado_desde: origin.id };
      records.set(id, continuation);
      writes.set(id, continuation);
    }
  }
  return { writes: [...writes.values()], hasDropout: Boolean(origin) };
};

import { getPostgresPool } from '../postgres.js';

// Keep embedded evidence in storage, not in every bootstrap/poll response.
export const readAttendanceSummaries = async (): Promise<Array<Record<string, unknown>>> => {
  const result = await getPostgresPool().query(`
    SELECT document_id, (payload - 'evidencia_imagen') || jsonb_build_object(
      'evidencia_disponible', COALESCE(length(payload ->> 'evidencia_imagen'), 0) > 0
    ) AS payload
    FROM tigre_rh.current_documents
    WHERE collection_name = 'attendance' AND NOT is_deleted
  `);
  return result.rows.map((row: { document_id: string; payload: Record<string, unknown> }) => ({ ...row.payload, id: row.document_id }));
};

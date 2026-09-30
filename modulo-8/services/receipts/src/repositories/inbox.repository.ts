import { pool } from '../db/pool';

/**
 * Bandeja de entrada del consumidor: registro de los mensajes ya procesados.
 * RabbitMQ entrega al menos una vez, de modo que el mismo mensaje puede llegar
 * de nuevo tras una reconexion o un reintento; el messageId permite reconocerlo.
 */
export async function wasProcessed(messageId: string): Promise<boolean> {
  const result = await pool.query('SELECT 1 FROM receipts.processed_messages WHERE message_id = $1', [messageId]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Marca el mensaje como procesado. Si dos entregas del mismo mensaje llegan a
 * este punto a la vez, la clave primaria deja registrada una sola.
 */
export async function markProcessed(messageId: string, eventType: string, correlationId: string): Promise<void> {
  await pool.query(
    `INSERT INTO receipts.processed_messages (message_id, event_type, correlation_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (message_id) DO NOTHING`,
    [messageId, eventType, correlationId],
  );
}

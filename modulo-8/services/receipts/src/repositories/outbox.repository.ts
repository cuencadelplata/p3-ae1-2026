import type { PoolClient } from 'pg';

import { pool } from '../db/pool';
import type { EventEnvelope } from '../messaging/envelope';

/**
 * Bandeja de salida (transactional outbox).
 *
 * Publicar en RabbitMQ despues de hacer COMMIT deja un hueco: si el proceso se
 * corta entre ambos pasos, el comprobante queda guardado y el evento se pierde,
 * porque la reentrega de payment.confirmed ya encuentra el comprobante emitido.
 * Por eso el evento se guarda en la misma transaccion que el comprobante y lo
 * publica despues el relay (messaging/outbox-relay.ts).
 */
export interface OutboxEvent<TData = unknown> {
  routingKey: string;
  envelope: EventEnvelope<TData>;
}

/** Inserta el evento dentro de la transaccion abierta en client. */
export async function enqueue(client: PoolClient, event: OutboxEvent): Promise<void> {
  const { envelope } = event;
  await client.query(
    `INSERT INTO receipts.outbox_events (message_id, event_type, routing_key, correlation_id, envelope)
     VALUES ($1, $2, $3, $4, $5)`,
    [envelope.messageId, envelope.eventType, event.routingKey, envelope.correlationId, JSON.stringify(envelope)],
  );
}

/**
 * Toma hasta limit eventos pendientes, los entrega a publish y, si publish
 * termina sin error, los marca como publicados. Si publish falla, la
 * transaccion se revierte y los eventos quedan pendientes para el proximo ciclo.
 *
 * FOR UPDATE SKIP LOCKED hace que dos instancias del servicio no tomen el mismo
 * evento: las filas que otra instancia esta publicando se saltean.
 */
export async function publishPending(
  limit: number,
  publish: (events: OutboxEvent[]) => Promise<void>,
): Promise<OutboxEvent[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ routing_key: string; envelope: EventEnvelope<unknown> }>(
      `SELECT routing_key, envelope
         FROM receipts.outbox_events
        WHERE published_at IS NULL
        ORDER BY created_at, message_id
        LIMIT $1
          FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    const events = result.rows.map((row) => ({ routingKey: row.routing_key, envelope: row.envelope }));

    if (events.length > 0) {
      await publish(events);
      await client.query(
        'UPDATE receipts.outbox_events SET published_at = now() WHERE message_id = ANY($1::uuid[])',
        [events.map((event) => event.envelope.messageId)],
      );
    }

    await client.query('COMMIT');
    return events;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

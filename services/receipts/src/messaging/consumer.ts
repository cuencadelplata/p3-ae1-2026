import * as amqp from 'amqplib';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';

import { PermanentMessageError } from './errors';
import { createLogger, errorMessage, withCorrelationId } from '../observability/logger';
import { assertTopology, type QueueTopology } from './topology';

type Connection = Awaited<ReturnType<typeof amqp.connect>>;

export const RETRY_COUNT_HEADER = 'x-retry-count';

export interface ConsumerOptions {
  /** Nombre para los logs. */
  name: string;
  url: string;
  topology: QueueTopology;
  prefetch: number;
  maxRetries: number;
  retryDelayMs: number;
  reconnectDelayMs?: number;
  handle: (content: Buffer) => Promise<unknown>;
}

export interface RunningConsumer {
  /** Se resuelve la primera vez que el consumidor queda escuchando la cola. */
  whenReady(): Promise<void>;
  isConnected(): boolean;
  close(): Promise<void>;
}

/**
 * correlationId del mensaje: la propiedad AMQP si el productor la envio, o el
 * campo del sobre. Se usa solo para los logs; la validacion la hace el handler.
 */
function correlationIdOf(message: ConsumeMessage): string | undefined {
  const fromProperties: unknown = message.properties.correlationId;
  if (typeof fromProperties === 'string' && fromProperties !== '') {
    return fromProperties;
  }
  try {
    const parsed = JSON.parse(message.content.toString('utf8')) as { correlationId?: unknown };
    return typeof parsed.correlationId === 'string' ? parsed.correlationId : undefined;
  } catch {
    return undefined;
  }
}

function retryCount(message: ConsumeMessage): number {
  const value = Number(message.properties.headers?.[RETRY_COUNT_HEADER] ?? 0);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

/**
 * Consume una cola con confirmacion manual:
 *
 * - Exito: ACK, el mensaje sale de la cola.
 * - Error permanente: NACK sin reencolar, RabbitMQ lo envia a la DLQ.
 * - Error transitorio: se republica en la cola de reintentos con el contador
 *   incrementado y se confirma el original. Agotados los reintentos, a la DLQ.
 *
 * El ACK se envia recien cuando el procesamiento termino: si el proceso se cae
 * a mitad de camino, RabbitMQ vuelve a entregar el mensaje.
 */
export function startConsumer(options: ConsumerOptions): RunningConsumer {
  const reconnectDelayMs = options.reconnectDelayMs ?? 5000;
  const { topology } = options;

  let connection: Connection | null = null;
  let closing = false;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  const log = createLogger(options.name);

  async function sendToRetry(channel: ConfirmChannel, message: ConsumeMessage, attempt: number): Promise<void> {
    channel.sendToQueue(topology.retryQueue, message.content, {
      persistent: true,
      contentType: message.properties.contentType,
      messageId: message.properties.messageId,
      expiration: String(options.retryDelayMs),
      headers: { ...message.properties.headers, [RETRY_COUNT_HEADER]: attempt },
    });
    await channel.waitForConfirms();
  }

  async function onMessage(channel: ConfirmChannel, message: ConsumeMessage): Promise<void> {
    const attempt = retryCount(message);
    const fields = { queue: topology.queue, messageId: message.properties.messageId, attempt };

    try {
      await options.handle(message.content);
      channel.ack(message);
      return;
    } catch (error) {
      const reason = errorMessage(error);

      if (error instanceof PermanentMessageError) {
        log('warn', 'mensaje invalido enviado a la DLQ', { ...fields, reason, details: error.details.join('; ') });
        channel.nack(message, false, false);
        return;
      }

      if (attempt >= options.maxRetries) {
        log('error', 'reintentos agotados, mensaje enviado a la DLQ', { ...fields, reason });
        channel.nack(message, false, false);
        return;
      }

      try {
        await sendToRetry(channel, message, attempt + 1);
        channel.ack(message);
        log('warn', 'fallo transitorio, mensaje programado para reintento', {
          ...fields,
          nextAttempt: attempt + 1,
          delayMs: options.retryDelayMs,
          reason,
        });
      } catch (retryError) {
        // Si no se pudo programar el reintento, el mensaje vuelve a la cola
        // principal para no perderlo.
        log('error', 'no se pudo programar el reintento, se devuelve a la cola', {
          ...fields,
          reason: errorMessage(retryError),
        });
        channel.nack(message, false, true);
      }
    }
  }

  function scheduleReconnect(): void {
    if (closing || reconnectTimer) {
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void connect();
    }, reconnectDelayMs);
  }

  async function connect(): Promise<void> {
    let candidate: Connection | null = null;
    try {
      candidate = await amqp.connect(options.url);
      const channel = await candidate.createConfirmChannel();
      await assertTopology(channel, topology);
      await channel.prefetch(options.prefetch);
      await channel.consume(topology.queue, (message) => {
        if (message) {
          // Todo lo que se registre al procesar el mensaje lleva su correlationId.
          void withCorrelationId(correlationIdOf(message), () => onMessage(channel, message)).catch((error: unknown) => {
            log('error', 'error inesperado al confirmar el mensaje', { reason: errorMessage(error) });
          });
        }
      });

      candidate.on('error', (error: Error) => log('error', 'error en la conexion con RabbitMQ', { reason: error.message }));
      candidate.on('close', () => {
        connection = null;
        if (!closing) {
          log('warn', 'conexion con RabbitMQ cerrada, reintentando', { delayMs: reconnectDelayMs });
          scheduleReconnect();
        }
      });

      connection = candidate;
      log('info', 'escuchando la cola', { queue: topology.queue, routingKey: topology.routingKey });
      markReady();
    } catch (error) {
      log('error', 'no se pudo conectar con RabbitMQ, reintentando', {
        reason: errorMessage(error),
        delayMs: reconnectDelayMs,
      });
      await candidate?.close().catch(() => undefined);
      scheduleReconnect();
    }
  }

  void connect();

  return {
    whenReady: () => ready,
    isConnected: () => connection !== null,
    async close() {
      closing = true;
      clearTimeout(reconnectTimer);
      const current = connection;
      connection = null;
      await current?.close().catch(() => undefined);
    },
  };
}

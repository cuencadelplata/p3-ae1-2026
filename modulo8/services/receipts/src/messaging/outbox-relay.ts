import * as amqp from 'amqplib';
import type { ConfirmChannel } from 'amqplib';

import * as outbox from '../repositories/outbox.repository';
import { createLogger, errorMessage, withCorrelationId } from '../observability/logger';

type Connection = Awaited<ReturnType<typeof amqp.connect>>;

export interface OutboxRelayOptions {
  /** Nombre para los logs. */
  name: string;
  url: string;
  exchange: string;
  /** Espera entre revisiones de la bandeja de salida, en milisegundos. */
  intervalMs: number;
  /** Eventos que se publican por revision. */
  batchSize: number;
  reconnectDelayMs?: number;
}

export interface RunningRelay {
  /** Se resuelve la primera vez que el relay queda conectado a RabbitMQ. */
  whenReady(): Promise<void>;
  isConnected(): boolean;
  close(): Promise<void>;
}

/**
 * Publica en RabbitMQ los eventos pendientes de la bandeja de salida.
 *
 * Un evento se marca como publicado recien cuando RabbitMQ confirmo que lo
 * recibio. Si RabbitMQ no esta disponible, el evento espera en la tabla y se
 * publica al recuperar la conexion.
 *
 * Si el proceso se corta entre la confirmacion de RabbitMQ y la marca en la
 * base, el evento se vuelve a publicar con el mismo messageId: la entrega es al
 * menos una vez y los consumidores descartan los repetidos por messageId.
 */
export function startOutboxRelay(options: OutboxRelayOptions): RunningRelay {
  const reconnectDelayMs = options.reconnectDelayMs ?? 5000;
  const log = createLogger(options.name);

  let connection: Connection | null = null;
  let channel: ConfirmChannel | null = null;
  let closing = false;
  let failing = false;
  let pollTimer: NodeJS.Timeout | undefined;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  function publishBatch(target: ConfirmChannel): (events: outbox.OutboxEvent[]) => Promise<void> {
    return async (events) => {
      for (const { routingKey, envelope } of events) {
        target.publish(options.exchange, routingKey, Buffer.from(JSON.stringify(envelope)), {
          persistent: true,
          contentType: 'application/json',
          messageId: envelope.messageId,
          correlationId: envelope.correlationId,
          type: envelope.eventType,
        });
      }
      await target.waitForConfirms();
    };
  }

  async function poll(): Promise<void> {
    let delay = options.intervalMs;
    const current = channel;

    if (current) {
      try {
        const published = await outbox.publishPending(options.batchSize, publishBatch(current));
        for (const { routingKey, envelope } of published) {
          withCorrelationId(envelope.correlationId, () =>
            log('info', 'evento publicado', { routingKey, messageId: envelope.messageId, tripId: envelope.correlationId }),
          );
        }
        if (failing) {
          failing = false;
          log('info', 'publicacion de eventos restablecida');
        }
        // Si se lleno el lote puede haber mas pendientes: se sigue sin esperar.
        if (published.length === options.batchSize) {
          delay = 0;
        }
      } catch (error) {
        // Se informa una sola vez por corte para no repetir el mismo log en cada ciclo.
        if (!failing) {
          failing = true;
          log('warn', 'no se pudieron publicar los eventos pendientes, quedan en la bandeja de salida', {
            reason: errorMessage(error),
          });
        }
      }
    }

    if (!closing) {
      pollTimer = setTimeout(() => {
        running = poll();
      }, delay);
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
      const confirmChannel = await candidate.createConfirmChannel();
      await confirmChannel.assertExchange(options.exchange, 'topic', { durable: true });

      const opened = candidate;
      confirmChannel.on('error', (error: Error) => log('error', 'error en el canal de publicacion', { reason: error.message }));
      // Sin canal no se puede publicar: se cierra la conexion para reconectar.
      confirmChannel.on('close', () => {
        channel = null;
        void opened.close().catch(() => undefined);
      });
      candidate.on('error', (error: Error) => log('error', 'error en la conexion con RabbitMQ', { reason: error.message }));
      candidate.on('close', () => {
        connection = null;
        channel = null;
        if (!closing) {
          log('warn', 'conexion con RabbitMQ cerrada, reintentando', { delayMs: reconnectDelayMs });
          scheduleReconnect();
        }
      });

      connection = candidate;
      channel = confirmChannel;
      log('info', 'publicando eventos', { exchange: options.exchange });
      markReady();
    } catch (error) {
      log('error', 'no se pudo conectar con RabbitMQ, reintentando', { reason: errorMessage(error), delayMs: reconnectDelayMs });
      await candidate?.close().catch(() => undefined);
      scheduleReconnect();
    }
  }

  void connect();
  running = poll();

  return {
    whenReady: () => ready,
    isConnected: () => channel !== null,
    async close() {
      closing = true;
      clearTimeout(pollTimer);
      clearTimeout(reconnectTimer);
      await running;
      const current = connection;
      connection = null;
      channel = null;
      await current?.close().catch(() => undefined);
    },
  };
}

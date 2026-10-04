import type { Channel, ConsumeMessage } from 'amqplib';
import { adaptExternalEvent } from './adapters';
import type { EventEnvelope } from './envelope';
import { parseEnvelope } from './envelope';
import { NonRetryableMessagingError } from './errors';
import type { TechnicalInboxStore } from './inbox';
import { buildQueueTopology, QueueTopology, QueueTopologyOptions } from './topology';

export type EventHandler<TData = Record<string, unknown>> = (event: EventEnvelope<TData>) => Promise<void>;

export interface EventConsumerOptions {
  consumerId: string;
  topology: QueueTopologyOptions;
  inboxStore: TechnicalInboxStore;
  maxRetries?: number;
  retryDelayMs?: number;
  logger?: {
    info(msg: string, meta?: unknown): void;
    warn(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
}

/**
 * Publica en RabbitMQ con soporte de Publisher Confirm antes de confirmar el mensaje original.
 */
export async function publishWithConfirm(
  channel: Channel,
  exchange: string,
  routingKey: string,
  content: Buffer,
  options: Record<string, unknown>
): Promise<void> {
  const chAny = channel as any;
  if (typeof chAny.publish === 'function' && chAny.publish.length >= 5) {
    await new Promise<void>((resolve, reject) => {
      const ok = chAny.publish(exchange, routingKey, content, options, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
      if (!ok && typeof chAny.once === 'function') {
        chAny.once('drain', () => {});
      }
    });
  } else {
    channel.publish(exchange, routingKey, content, options as any);
    if (typeof chAny.waitForConfirms === 'function') {
      await chAny.waitForConfirms();
    }
  }
}

/**
 * Consumidor de eventos AMQP centralizado de RF8.6.
 * Implementa validacion de envelope, adaptadores externos, Inbox tecnico atomico UNIQUE(consumerId, messageId),
 * Publisher Confirms en reintento/DLQ, politica de 3 reintentos y derivacion a Dead Letter Queue (DLQ).
 */
export class EventConsumer {
  private readonly consumerId: string;
  private readonly topology: QueueTopology;
  private readonly inboxStore: TechnicalInboxStore;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly handlers = new Map<string, EventHandler<any>>();
  private readonly logger: NonNullable<EventConsumerOptions['logger']>;
  private consumerTag?: string;

  constructor(options: EventConsumerOptions) {
    this.consumerId = options.consumerId;
    this.topology = buildQueueTopology(options.topology);
    this.inboxStore = options.inboxStore;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 5000;
    this.logger = options.logger ?? {
      info: (msg, meta) => console.log(`[RF8.6][${this.consumerId}] INFO: ${msg}`, meta ?? ''),
      warn: (msg, meta) => console.warn(`[RF8.6][${this.consumerId}] WARN: ${msg}`, meta ?? ''),
      error: (msg, meta) => console.error(`[RF8.6][${this.consumerId}] ERROR: ${msg}`, meta ?? ''),
    };
  }

  /** Registra un handler de negocio para un eventType especifico. */
  registerHandler<T = Record<string, unknown>>(eventType: string, handler: EventHandler<T>): this {
    this.handlers.set(eventType, handler);
    return this;
  }

  /** Inicia el consumo en el canal de RabbitMQ. */
  async start(channel: Channel): Promise<void> {
    const res = await channel.consume(
      this.topology.queue,
      (msg) => {
        if (msg) {
          this.processMessage(channel, msg).catch((err) => {
            this.logger.error('Error no capturado en procesamiento de mensaje AMQP', err);
          });
        }
      },
      { noAck: false }
    );
    this.consumerTag = res.consumerTag;
    this.logger.info(`Consumidor RF8.6 iniciado en cola ${this.topology.queue}`);
  }

  /** Detiene el consumo. */
  async stop(channel: Channel): Promise<void> {
    if (this.consumerTag) {
      await channel.cancel(this.consumerTag);
      this.consumerTag = undefined;
    }
  }

  /**
   * Procesa un mensaje AMQP individual aplicando las reglas de RF8.6.
   */
  async processMessage(channel: Channel, msg: ConsumeMessage): Promise<void> {
    const headers = msg.properties.headers || {};
    const retryCount = (headers['x-retry-count'] as number) || 0;

    let envelope: EventEnvelope;
    try {
      envelope = adaptExternalEvent(msg.content, msg.fields.routingKey);
    } catch (err) {
      this.logger.error('Mensaje invalido o corrupto recibido. Enviando a DLQ.', { error: err });
      await this.sendToDLQ(channel, msg, String((err as Error).message || err));
      return;
    }

    // 1. Reclamo atomico en Inbox tecnico (Deduplicacion y proteccion de concurrencia)
    let claimed = false;
    try {
      claimed = await this.inboxStore.claim(this.consumerId, envelope.messageId, envelope.eventType);
      if (!claimed) {
        this.logger.info(`Mensaje ${envelope.messageId} ya reclamado/procesado por ${this.consumerId}. ACK sin re-ejecutar.`);
        channel.ack(msg);
        return;
      }
    } catch (err) {
      this.logger.error('Fallo al consultar/reclamar el Inbox tecnico. Se incrementa el contador de reintento.', { error: err });
      const nextRetry = retryCount + 1;
      if (nextRetry > this.maxRetries) {
        await this.sendToDLQ(channel, msg, `Fallo persistente de Inbox: ${(err as Error).message}`);
      } else {
        await this.scheduleRetry(channel, msg, nextRetry);
      }
      return;
    }

    // 2. Localizar handler registrado
    const handler = this.handlers.get(envelope.eventType);
    if (!handler) {
      this.logger.warn(`No hay handler registrado para eventType ${envelope.eventType}. ACK.`);
      await this.inboxStore.markAsCompleted(this.consumerId, envelope.messageId);
      channel.ack(msg);
      return;
    }

    // 3. Ejecutar handler del RF correspondiente de forma atomica con la marca final
    try {
      await handler(envelope);
      await this.inboxStore.markAsCompleted(this.consumerId, envelope.messageId);
      channel.ack(msg);
      this.logger.info(`Evento ${envelope.eventType} (${envelope.messageId}) procesado correctamente por ${this.consumerId}.`);
    } catch (err) {
      await this.inboxStore.releaseClaim(this.consumerId, envelope.messageId);

      const isFatal = err instanceof NonRetryableMessagingError;
      const isRetryExceeded = retryCount >= this.maxRetries;

      if (isFatal || isRetryExceeded) {
        this.logger.error(
          `Fallo definitivo en mensaje ${envelope.messageId} (intento ${retryCount + 1}/${this.maxRetries + 1}). Desviando a DLQ.`,
          { error: err }
        );
        await this.sendToDLQ(channel, msg, String((err as Error).message || err));
      } else {
        this.logger.warn(
          `Fallo reintentable en mensaje ${envelope.messageId} (intento ${retryCount + 1}/${this.maxRetries + 1}). Programando reintento.`,
          { error: err }
        );
        await this.scheduleRetry(channel, msg, retryCount + 1);
      }
    }
  }

  private async scheduleRetry(channel: Channel, msg: ConsumeMessage, newRetryCount: number): Promise<void> {
    const headers = { ...msg.properties.headers, 'x-retry-count': newRetryCount };
    await publishWithConfirm(channel, '', this.topology.retryQueue, msg.content, {
      ...msg.properties,
      headers,
      expiration: String(this.retryDelayMs),
    });
    channel.ack(msg);
  }

  private async sendToDLQ(channel: Channel, msg: ConsumeMessage, reason: string): Promise<void> {
    const headers = { ...msg.properties.headers, 'x-dlq-reason': reason, 'x-dlq-at': new Date().toISOString() };
    await publishWithConfirm(channel, this.topology.deadLetterExchange, this.topology.queue, msg.content, {
      ...msg.properties,
      headers,
    });
    channel.ack(msg);
  }
}


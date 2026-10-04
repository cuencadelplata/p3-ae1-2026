import type { Channel, ConsumeMessage } from 'amqplib';
import { adaptExternalEvent } from './adapters';
import type { EventEnvelope } from './envelope';
import { MessagingError, NonRetryableMessagingError } from './errors';
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
 * Consumidor de eventos AMQP centralizado de RF8.6.
 * Implementa validacion de envelope, adaptadores externos, Inbox tecnico UNIQUE(consumerId, messageId),
 * politica de 3 reintentos y derivacion a Dead Letter Queue (DLQ).
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
      await this.sendToDLQ(channel, msg, 'Mensaje no interpretable como JSON');
      return;
    }

    // 1. Verificacion de Inbox tecnico (Deduplicacion)
    try {
      const alreadyProcessed = await this.inboxStore.hasBeenProcessed(this.consumerId, envelope.messageId);
      if (alreadyProcessed) {
        this.logger.info(`Mensaje ${envelope.messageId} ya procesado por ${this.consumerId}. ACK sin re-ejecutar.`);
        channel.ack(msg);
        return;
      }
    } catch (err) {
      this.logger.error('Fallo al consultar el Inbox tecnico. Se reintentara.', { error: err });
      await this.scheduleRetry(channel, msg, retryCount);
      return;
    }

    // 2. Localizar handler registrado
    const handler = this.handlers.get(envelope.eventType);
    if (!handler) {
      this.logger.warn(`No hay handler registrado para eventType ${envelope.eventType}. ACK.`);
      channel.ack(msg);
      return;
    }

    // 3. Ejecutar handler del RF correspondiente
    try {
      await handler(envelope);
      await this.inboxStore.markAsProcessed(this.consumerId, envelope.messageId, envelope.eventType);
      channel.ack(msg);
      this.logger.info(`Evento ${envelope.eventType} (${envelope.messageId}) procesado correctamente por ${this.consumerId}.`);
    } catch (err) {
      const isFatal = err instanceof NonRetryableMessagingError;
      const isRetryExceeded = retryCount >= this.maxRetries;

      if (isFatal || isRetryExceeded) {
        this.logger.error(
          `Fallo definitivo en mensaje ${envelope.messageId} (intento ${retryCount + 1}/${this.maxRetries + 1}). Desviando a DLQ.`,
          { error: err }
        );
        await this.sendToDLQ(channel, msg, String(err));
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
    channel.publish('', this.topology.retryQueue, msg.content, {
      ...msg.properties,
      headers,
      expiration: String(this.retryDelayMs),
    });
    channel.ack(msg);
  }

  private async sendToDLQ(channel: Channel, msg: ConsumeMessage, reason: string): Promise<void> {
    const headers = { ...msg.properties.headers, 'x-dlq-reason': reason, 'x-dlq-at': new Date().toISOString() };
    channel.publish(this.topology.deadLetterExchange, this.topology.queue, msg.content, {
      ...msg.properties,
      headers,
    });
    channel.ack(msg);
  }
}

import type { Channel, ChannelModel } from 'amqplib';
import { EventConsumer } from './consumer';
import type { EventEnvelope } from './envelope';
import { NonRetryableMessagingError } from './errors';
import type { TechnicalInboxStore } from './inbox';
import { assertTopology, buildQueueTopology } from './topology';

export const M3_EXCHANGE = 'm3.eventos';
export const M3_ROUTING_KEY = 'documento.registrado';
export const M3_QUEUE = 'm8.notificaciones.documento-registrado';
export const M3_CONSUMER_ID = 'm8.notificaciones.documento-registrado';
export const M3_EVENT_TYPE = 'DriverDocumentRegistered';

export interface M3DriverDocumentRegisteredPayload {
  documentId: string;
  driverId: number;
  tipoDocumento: string;
}

export interface M3DriverDocumentRegisteredEnvelope {
  messageId: string;
  eventType: typeof M3_EVENT_TYPE;
  version: number;
  occurredAt: string;
  correlationId: string;
  producer: string;
  data: M3DriverDocumentRegisteredPayload;
}

export interface Rf81DocumentNotificationInput {
  messageId: string;
  eventType: 'DriverDocumentRegistered';
  documentId: string;
  driverId: number;
  tipoDocumento: string;
  correlationId: string;
  occurredAt: string;
}

export interface Rf81HandlerResult {
  status: 'SUCCESS_CREATED' | 'SUCCESS_ALREADY_PROCESSED' | 'INVALID_EVENT' | 'PERSISTENCE_FAILURE';
  valid: boolean;
  details?: unknown;
  error?: unknown;
}

export type Rf81DocumentHandler = (event: Rf81DocumentNotificationInput) => Promise<Rf81HandlerResult>;

export interface M3DriverDocumentConsumerOptions {
  connection: ChannelModel;
  inboxStore: TechnicalInboxStore;
  rf81Handler: Rf81DocumentHandler;
  maxRetries?: number;
  retryDelayMs?: number;
  logger?: {
    info(msg: string, meta?: unknown): void;
    warn(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
}

export function validateAndAdaptM3Envelope(raw: Record<string, unknown>): Rf81DocumentNotificationInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new NonRetryableMessagingError('El evento de M3 debe ser un objeto JSON.');
  }

  const messageId = typeof raw.messageId === 'string' ? raw.messageId.trim() : '';
  if (!messageId) {
    throw new NonRetryableMessagingError('messageId es obligatorio en el evento de M3.');
  }

  const eventType = raw.eventType;
  if (eventType !== M3_EVENT_TYPE) {
    throw new NonRetryableMessagingError(`eventType inválido: esperado '${M3_EVENT_TYPE}', recibido '${eventType}'.`);
  }

  const data = (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data))
    ? (raw.data as Record<string, unknown>)
    : raw;

  const documentId = typeof data.documentId === 'string' ? data.documentId.trim() : '';
  if (!documentId) {
    throw new NonRetryableMessagingError('data.documentId es obligatorio.');
  }

  // driverId debe ser el userId numérico positivo canónico de M1
  const driverId = Number(data.driverId);
  if (!Number.isInteger(driverId) || driverId <= 0) {
    throw new NonRetryableMessagingError('data.driverId debe ser un entero positivo (userId canónico de M1).');
  }

  const tipoDocumento = typeof data.tipoDocumento === 'string' ? data.tipoDocumento.trim() : '';
  if (!tipoDocumento) {
    throw new NonRetryableMessagingError('data.tipoDocumento es obligatorio.');
  }

  const correlationId = typeof raw.correlationId === 'string' && raw.correlationId.trim() !== ''
    ? raw.correlationId.trim()
    : documentId;

  const occurredAt = typeof raw.occurredAt === 'string' && !Number.isNaN(Date.parse(raw.occurredAt))
    ? raw.occurredAt
    : new Date().toISOString();

  return {
    messageId,
    eventType: 'DriverDocumentRegistered',
    documentId,
    driverId,
    tipoDocumento,
    correlationId,
    occurredAt,
  };
}

/**
 * Consumidor AMQP técnico de RF8.6 para eventos emitidos por M3:
 * exchange: m3.eventos
 * queue: m8.notificaciones.documento-registrado
 * routingKey: documento.registrado
 *
 * Entrega el evento validado a RF8.1 con Inbox e idempotencia técnica estricta.
 */
export class M3DriverDocumentConsumer {
  private channel?: Channel;
  private consumer?: EventConsumer;
  private isRunning = false;

  constructor(private readonly options: M3DriverDocumentConsumerOptions) {}

  async start(): Promise<void> {
    if (this.isRunning) return;

    const channel = await this.options.connection.createConfirmChannel();
    this.channel = channel;

    const topology = buildQueueTopology({
      exchange: M3_EXCHANGE,
      queue: M3_QUEUE,
      routingKey: M3_ROUTING_KEY,
    });

    await assertTopology(channel, topology);

    this.consumer = new EventConsumer({
      consumerId: M3_CONSUMER_ID,
      topology: {
        exchange: M3_EXCHANGE,
        queue: M3_QUEUE,
        routingKey: M3_ROUTING_KEY,
      },
      inboxStore: this.options.inboxStore,
      maxRetries: this.options.maxRetries ?? 3,
      retryDelayMs: this.options.retryDelayMs ?? 5000,
      logger: this.options.logger,
    });

    this.consumer.registerHandler(M3_EVENT_TYPE, async (envelope: EventEnvelope) => {
      const adapted = validateAndAdaptM3Envelope(envelope as unknown as Record<string, unknown>);
      const result = await this.options.rf81Handler(adapted);

      if (result.status === 'INVALID_EVENT') {
        throw new NonRetryableMessagingError(
          `Evento rechazado por validación de negocio de RF8.1: ${JSON.stringify(result.details)}`
        );
      }
      if (result.status === 'PERSISTENCE_FAILURE') {
        throw new Error(`Fallo de persistencia en RF8.1: ${String(result.error)}`);
      }
    });

    await this.consumer.start(channel);
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    if (!this.isRunning || !this.channel) return;
    if (this.consumer) {
      await this.consumer.stop(this.channel).catch(() => {});
    }
    await this.channel.close().catch(() => {});
    this.channel = undefined;
    this.isRunning = false;
  }

  isReady(): boolean {
    return this.isRunning && !!this.channel;
  }

  getChannel(): Channel | undefined {
    return this.channel;
  }
}

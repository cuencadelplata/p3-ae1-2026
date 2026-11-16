import {
  assertTopology,
  buildQueueTopology,
  EventConsumer,
  NonRetryableMessagingError,
  type EventEnvelope,
  type TechnicalInboxStore,
} from "@m8/shared";

import type { ProcessDriverDocumentRegisteredEventResult } from "../notifications/normalized-trip-notification.service";

export const M3_DOCUMENTS_EXCHANGE = "m3.eventos";
export const M3_DOCUMENT_REGISTERED_ROUTING_KEY = "documento.registrado";
export const M3_DOCUMENT_REGISTERED_QUEUE = "m8.notificaciones.documento-registrado";
export const M3_DOCUMENT_REGISTERED_CONSUMER_ID = M3_DOCUMENT_REGISTERED_QUEUE;

type RabbitMqChannel = Parameters<EventConsumer["start"]>[0];

export interface RabbitMqConnection {
  createConfirmChannel(): Promise<RabbitMqChannel>;
  close(): Promise<void>;
  on?(event: string, listener: (...args: any[]) => void): unknown;
}

interface DriverDocumentRegisteredData {
  documentId: string;
  driverId: number;
  tipoDocumento: string;
}

export interface M3DriverDocumentRegisteredConsumerOptions {
  connection: RabbitMqConnection;
  inboxStore: TechnicalInboxStore;
  deliverToRf81(value: unknown): Promise<ProcessDriverDocumentRegisteredEventResult>;
  onDisconnected?: () => void;
  maxRetries?: number;
  retryDelayMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new NonRetryableMessagingError(`${field} es obligatorio y debe ser texto no vacío.`);
  }
  return value;
}

/** Valida el contrato externo de M3 sin fabricar IDs ni valores por defecto. */
export function parseM3DriverDocumentRegisteredEnvelope(content: Buffer): EventEnvelope<DriverDocumentRegisteredData> {
  let raw: unknown;
  try {
    raw = JSON.parse(content.toString("utf8"));
  } catch {
    throw new NonRetryableMessagingError("El mensaje de M3 no es JSON válido.");
  }
  if (!isRecord(raw)) {
    throw new NonRetryableMessagingError("El envelope de M3 debe ser un objeto JSON.");
  }

  const messageId = requireText(raw.messageId, "messageId");
  if (!UUID_PATTERN.test(messageId)) {
    throw new NonRetryableMessagingError("messageId debe ser un UUID válido.");
  }
  if (raw.eventType !== "DriverDocumentRegistered") {
    throw new NonRetryableMessagingError("eventType debe ser DriverDocumentRegistered.");
  }
  if (raw.version !== 1) {
    throw new NonRetryableMessagingError("version debe ser 1.");
  }
  const occurredAt = requireText(raw.occurredAt, "occurredAt");
  if (Number.isNaN(Date.parse(occurredAt))) {
    throw new NonRetryableMessagingError("occurredAt debe ser ISO 8601 válido.");
  }
  const correlationId = requireText(raw.correlationId, "correlationId");
  if (!UUID_PATTERN.test(correlationId)) {
    throw new NonRetryableMessagingError("correlationId debe ser un UUID válido.");
  }
  if (raw.producer !== "m3-conductores") {
    throw new NonRetryableMessagingError("producer debe ser m3-conductores.");
  }
  if (!isRecord(raw.data)) {
    throw new NonRetryableMessagingError("data debe ser un objeto.");
  }

  const documentId = requireText(raw.data.documentId, "data.documentId");
  if (!UUID_PATTERN.test(documentId)) {
    throw new NonRetryableMessagingError("data.documentId debe ser un UUID válido.");
  }
  if (correlationId !== documentId) {
    throw new NonRetryableMessagingError("correlationId debe coincidir con data.documentId.");
  }
  const driverId = raw.data.driverId;
  if (typeof driverId !== "number" || !Number.isSafeInteger(driverId) || driverId <= 0) {
    throw new NonRetryableMessagingError("data.driverId debe ser el userId numérico positivo de M1.");
  }
  const tipoDocumento = requireText(raw.data.tipoDocumento, "data.tipoDocumento");

  return {
    messageId,
    eventType: "DriverDocumentRegistered",
    version: 1,
    occurredAt,
    correlationId,
    producer: "m3-conductores",
    data: { documentId, driverId, tipoDocumento },
  };
}

function toRf81Event(envelope: EventEnvelope<DriverDocumentRegisteredData>): Record<string, unknown> {
  return {
    messageId: envelope.messageId,
    eventType: envelope.eventType,
    documentId: envelope.data.documentId,
    driverId: envelope.data.driverId,
    tipoDocumento: envelope.data.tipoDocumento,
    correlationId: envelope.correlationId,
    occurredAt: envelope.occurredAt,
  };
}

export class M3DriverDocumentRegisteredConsumer {
  private channel?: RabbitMqChannel;
  private consumer?: EventConsumer;
  private running = false;

  constructor(private readonly options: M3DriverDocumentRegisteredConsumerOptions) {}

  async start(): Promise<void> {
    if (this.running) return;

    const channel = await this.options.connection.createConfirmChannel();
    let channelClosed = false;
    channel.on?.('close', () => {
      channelClosed = true;
      this.running = false;
      this.options.onDisconnected?.();
    });
    channel.on?.('error', (error: unknown) => {
      console.warn('[RF8.6] Error en el canal M3.', error);
    });
    const topology = buildQueueTopology({
      exchange: M3_DOCUMENTS_EXCHANGE,
      queue: M3_DOCUMENT_REGISTERED_QUEUE,
      routingKey: M3_DOCUMENT_REGISTERED_ROUTING_KEY,
    });
    await assertTopology(channel, topology);

    const consumer = new EventConsumer({
      consumerId: M3_DOCUMENT_REGISTERED_CONSUMER_ID,
      topology: {
        exchange: M3_DOCUMENTS_EXCHANGE,
        queue: M3_DOCUMENT_REGISTERED_QUEUE,
        routingKey: M3_DOCUMENT_REGISTERED_ROUTING_KEY,
      },
      inboxStore: this.options.inboxStore,
      maxRetries: this.options.maxRetries ?? 3,
      retryDelayMs: this.options.retryDelayMs ?? 5000,
      parseEvent: parseM3DriverDocumentRegisteredEnvelope,
    });
    consumer.registerHandler("DriverDocumentRegistered", async (envelope) => {
      const result = await this.options.deliverToRf81(
        toRf81Event(envelope as unknown as EventEnvelope<DriverDocumentRegisteredData>),
      );
      if (!result.valid && result.status === "INVALID_EVENT") {
        throw new NonRetryableMessagingError("RF8.1 rechazó el evento DriverDocumentRegistered.");
      }
      if (!result.valid) {
        throw result.error;
      }
    });

    await consumer.start(channel);
    if (channelClosed) throw new Error('El canal RabbitMQ se cerró durante el arranque del consumer M3.');
    this.channel = channel;
    this.consumer = consumer;
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.channel) return;
    await this.consumer?.stop(this.channel).catch(() => undefined);
    await this.channel.close().catch(() => undefined);
    this.channel = undefined;
    this.consumer = undefined;
    this.running = false;
  }

  isReady(): boolean {
    return this.running;
  }
}

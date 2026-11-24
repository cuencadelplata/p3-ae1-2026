import {
  assertTopology,
  buildQueueTopology,
  EventConsumer,
  NonRetryableMessagingError,
  type EventEnvelope,
  type TechnicalInboxStore,
} from "@m8/shared";

import { mapTripEventEnvelope } from "../notifications/trip-event-envelope.mapper";
import type { ProcessNormalizedTripNotificationEventResult } from "../notifications/normalized-trip-notification.service";
import type { RabbitMqConnection } from "./m3-driver-document-registered.consumer";

export const M6_TRIP_EVENTS_QUEUE = "m8.notifications.trip-events";
export const M6_TRIP_EVENTS_EXCHANGE = "mobility.events";
export const M6_TRIP_EVENT_KEYS = {
  "driver.arrived": "DriverArrived",
  "trip.started": "TripStarted",
  // RF-8.1 finalizacion: M6 publica TripCompleted para M8 al completar el viaje
  // (desde su outbox, con data.tripId y data.recipientId = clientUserId).
  "trip.completed": "TripCompleted",
  // RF-8.1 cancelacion despues de la asignacion: M6 publica TripCancelled con el
  // mismo sobre, un mensaje por destinatario (cliente y conductor).
  "trip.cancelled": "TripCancelled",
} as const;

// DriverArrived y TripStarted salen con producer "m6"; TripCompleted sale del
// outbox de M6 con producer "m6-viajes". Los dos identifican al mismo modulo.
const M6_PRODUCERS: readonly string[] = ["m6", "m6-viajes"];

type RabbitMqChannel = Parameters<EventConsumer["start"]>[0];

export interface M6TripEventsConsumerOptions {
  connection: RabbitMqConnection;
  inboxStore: TechnicalInboxStore;
  deliverToRf81(value: unknown): Promise<ProcessNormalizedTripNotificationEventResult>;
  onDisconnected?: () => void;
  maxRetries?: number;
  retryDelayMs?: number;
}

export function parseM6TripEventEnvelope(content: Buffer, routingKey?: string): EventEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(content.toString("utf8"));
  } catch {
    throw new NonRetryableMessagingError("El evento de viaje no es JSON valido.");
  }
  const expectedType = M6_TRIP_EVENT_KEYS[routingKey as keyof typeof M6_TRIP_EVENT_KEYS];
  if (!expectedType) {
    throw new NonRetryableMessagingError("Routing key de viaje no permitida.");
  }
  const mapped = mapTripEventEnvelope(raw);
  if (!mapped.valid) {
    throw new NonRetryableMessagingError(
      `Evento de viaje invalido: ${mapped.details.map((detail) => detail.field).join(", ")}`,
    );
  }
  if (mapped.data.eventType !== expectedType) {
    throw new NonRetryableMessagingError("eventType no coincide con la routing key.");
  }
  if (!M6_PRODUCERS.includes((raw as EventEnvelope).producer)) {
    throw new NonRetryableMessagingError("producer debe ser m6 o m6-viajes.");
  }
  return raw as EventEnvelope;
}

export class M6TripEventsConsumer {
  private channel?: RabbitMqChannel;
  private consumer?: EventConsumer;
  private running = false;

  constructor(private readonly options: M6TripEventsConsumerOptions) {}

  async start(): Promise<void> {
    if (this.running) return;
    const channel = await this.options.connection.createConfirmChannel();
    let channelClosed = false;
    channel.on?.("close", () => {
      channelClosed = true;
      this.running = false;
      this.options.onDisconnected?.();
    });
    channel.on?.("error", (error: unknown) => {
      console.warn("[RF8.6] Error en el canal de eventos M6.", error);
    });
    const topology = buildQueueTopology({
      exchange: M6_TRIP_EVENTS_EXCHANGE,
      queue: M6_TRIP_EVENTS_QUEUE,
      routingKey: "driver.arrived",
    });
    await assertTopology(channel, topology);
    await channel.bindQueue(M6_TRIP_EVENTS_QUEUE, M6_TRIP_EVENTS_EXCHANGE, "trip.started");
    await channel.bindQueue(M6_TRIP_EVENTS_QUEUE, M6_TRIP_EVENTS_EXCHANGE, "trip.completed");
    await channel.bindQueue(M6_TRIP_EVENTS_QUEUE, M6_TRIP_EVENTS_EXCHANGE, "trip.cancelled");

    const consumer = new EventConsumer({
      consumerId: M6_TRIP_EVENTS_QUEUE,
      topology,
      inboxStore: this.options.inboxStore,
      maxRetries: this.options.maxRetries ?? 3,
      retryDelayMs: this.options.retryDelayMs ?? 5000,
      parseEvent: parseM6TripEventEnvelope,
    });
    for (const eventType of Object.values(M6_TRIP_EVENT_KEYS)) {
      consumer.registerHandler(eventType, async (envelope) => {
        const result = await this.options.deliverToRf81(envelope);
        if (!result.valid && result.status === "INVALID_EVENT") {
          throw new NonRetryableMessagingError("RF8.1 rechazo el evento de viaje.");
        }
        if (!result.valid) throw result.error;
      });
    }
    await consumer.start(channel);
    if (channelClosed) throw new Error("El canal RabbitMQ se cerro durante el arranque del consumer M6.");
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

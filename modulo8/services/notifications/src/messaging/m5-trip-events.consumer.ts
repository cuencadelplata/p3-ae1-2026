import {
  assertTopology,
  buildQueueTopology,
  EventConsumer,
  NonRetryableMessagingError,
  parseEnvelope,
  type EventEnvelope,
  type TechnicalInboxStore,
} from "@m8/shared";

import type { RabbitMqConnection } from "./m3-driver-document-registered.consumer";

export const M5_TRIP_EVENTS_QUEUE = "m8.notifications.m5-events";
export const M5_TRIP_EVENTS_EXCHANGE = "mobility.events";
export const M5_TRIP_EVENT_KEYS = {
  "ride.requested": "TripRequested",
  "driver.offer.accepted": "DriverAssigned",
  "ride_request.cancelled": "TripCancelled",
} as const;

type RabbitMqChannel = Parameters<EventConsumer["start"]>[0];

function validUserId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validLocation(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const location = value as Record<string, unknown>;
  return typeof location.latitude === "number" && Number.isFinite(location.latitude) &&
    location.latitude >= -90 && location.latitude <= 90 &&
    typeof location.longitude === "number" && Number.isFinite(location.longitude) &&
    location.longitude >= -180 && location.longitude <= 180 && validText(location.address);
}

function validFare(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const fare = value as Record<string, unknown>;
  return typeof fare.amount === "number" && Number.isFinite(fare.amount) &&
    fare.amount >= 0 && fare.currency === "ARS";
}

export function parseM5TripEventEnvelope(content: Buffer, routingKey?: string): EventEnvelope {
  const parsed = parseEnvelope(content);
  if (!parsed.ok || !parsed.value) {
    throw new NonRetryableMessagingError(`Sobre M5 invalido: ${parsed.errors?.join(", ")}`);
  }
  const raw = parsed.value;
  const eventType = M5_TRIP_EVENT_KEYS[routingKey as keyof typeof M5_TRIP_EVENT_KEYS];
  if (!eventType || raw.eventType !== routingKey || raw.producer !== "m5" || raw.version !== 1) {
    throw new NonRetryableMessagingError("Routing key, tipo, productor o version M5 no coinciden.");
  }
  const data = raw.data;
  if (!validUserId(data.clientUserId) || !validText(data.rideRequestId)) {
    throw new NonRetryableMessagingError("M5 debe enviar clientUserId numerico y rideRequestId.");
  }
  if (eventType === "DriverAssigned") {
    if (!validText(data.tripId) || !validUserId(data.driverUserId) ||
        data.clientUserId === data.driverUserId || raw.correlationId !== data.tripId) {
      throw new NonRetryableMessagingError("La asignacion M5 requiere tripId, dos usuarios distintos y correlationId=tripId.");
    }
    if (!validText(data.offerId) || (data.vehicleType !== "AUTO" && data.vehicleType !== "MOTO") ||
        !validLocation(data.origin) || !validLocation(data.destination) || !validFare(data.fare)) {
      throw new NonRetryableMessagingError("La asignacion M5 requiere offerId, vehiculo, recorrido y tarifa validos.");
    }
  } else if (raw.correlationId !== data.rideRequestId || "tripId" in data) {
    throw new NonRetryableMessagingError("La solicitud/cancelacion M5 requiere correlationId=rideRequestId y no admite tripId.");
  }
  if (eventType === "TripRequested") {
    if (typeof data.origin !== "object" || data.origin === null ||
        typeof data.destination !== "object" || data.destination === null ||
        !validText(data.vehicleType) || typeof data.estimatedFare !== "object" ||
        data.estimatedFare === null || !validText(data.createdAt)) {
      throw new NonRetryableMessagingError("Datos de solicitud M5 incompletos.");
    }
  }
  return { ...raw, eventType };
}

export interface M5TripEventsConsumerOptions {
  connection: RabbitMqConnection;
  inboxStore: TechnicalInboxStore;
  deliverToRf81(value: EventEnvelope): Promise<void>;
  onDisconnected?: () => void;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class M5TripEventsConsumer {
  private channel?: RabbitMqChannel;
  private consumer?: EventConsumer;
  private running = false;

  constructor(private readonly options: M5TripEventsConsumerOptions) {}

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
      console.warn("[RF8.6] Error en el canal de eventos M5.", error);
    });
    const topology = buildQueueTopology({
      exchange: M5_TRIP_EVENTS_EXCHANGE,
      queue: M5_TRIP_EVENTS_QUEUE,
      routingKey: "ride.requested",
    });
    await assertTopology(channel, topology);
    await channel.bindQueue(M5_TRIP_EVENTS_QUEUE, M5_TRIP_EVENTS_EXCHANGE, "driver.offer.accepted");
    await channel.bindQueue(M5_TRIP_EVENTS_QUEUE, M5_TRIP_EVENTS_EXCHANGE, "ride_request.cancelled");
    const consumer = new EventConsumer({
      consumerId: M5_TRIP_EVENTS_QUEUE,
      topology,
      inboxStore: this.options.inboxStore,
      maxRetries: this.options.maxRetries ?? 3,
      retryDelayMs: this.options.retryDelayMs ?? 5000,
      parseEvent: parseM5TripEventEnvelope,
    });
    for (const eventType of Object.values(M5_TRIP_EVENT_KEYS)) {
      consumer.registerHandler(eventType, (envelope) => this.options.deliverToRf81(envelope));
    }
    await consumer.start(channel);
    if (channelClosed) throw new Error("El canal RabbitMQ M5 se cerro durante el arranque.");
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

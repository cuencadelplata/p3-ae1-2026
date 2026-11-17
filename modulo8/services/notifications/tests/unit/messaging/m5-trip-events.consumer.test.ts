import { describe, expect, it, vi } from "vitest";
import { InMemoryTechnicalInbox } from "@m8/shared";

import {
  M5TripEventsConsumer,
  M5_TRIP_EVENTS_QUEUE,
  parseM5TripEventEnvelope,
} from "../../../src/messaging/m5-trip-events.consumer";

const rideRequestId = "req_550e8400-e29b-41d4-a716-446655440000";
const tripId = "viaje_m6_849201";
const base = {
  messageId: "c8b417d2-7b24-4f2e-848e-28f09d84bf01",
  eventType: "ride.requested",
  version: 1,
  occurredAt: "2026-11-17T12:30:00.000Z",
  correlationId: rideRequestId,
  producer: "m5",
  data: {
    rideRequestId,
    clientUserId: 105,
    origin: { latitude: -34.6037, longitude: -58.3816, address: "Origen" },
    destination: { latitude: -34.5885, longitude: -58.3974, address: "Destino" },
    vehicleType: "AUTO",
    estimatedFare: { amount: 2850.50, currency: "ARS" },
    createdAt: "2026-11-17T12:30:00.000Z",
  },
};
const accepted = {
  ...base,
  messageId: "d9f528e3-8c35-4e3f-959f-39f10e95cf02",
  eventType: "driver.offer.accepted",
  correlationId: tripId,
  data: {
    rideRequestId, tripId, offerId: "off_1", clientUserId: 105, driverUserId: 42,
    vehicleType: "AUTO",
    origin: { latitude: -34.6037, longitude: -58.3816, address: "Origen" },
    destination: { latitude: -34.5885, longitude: -58.3974, address: "Destino" },
    fare: { amount: 2850.50, currency: "ARS" },
  },
};
const cancelled = {
  ...base,
  messageId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  eventType: "ride_request.cancelled",
  data: { rideRequestId, clientUserId: 105, reason: "Cliente cancelo" },
};

function broker() {
  let receive: ((message: any) => void) | undefined;
  const channel = {
    on: vi.fn(),
    assertExchange: vi.fn().mockResolvedValue({}),
    assertQueue: vi.fn().mockResolvedValue({}),
    bindQueue: vi.fn().mockResolvedValue({}),
    consume: vi.fn(async (_queue: string, callback: (message: any) => void) => {
      receive = callback;
      return { consumerTag: "m5-events" };
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ack: vi.fn(),
    publish: vi.fn((_exchange: string, _key: string, _content: Buffer, _options: unknown, confirmed: () => void) => {
      confirmed();
      return true;
    }),
  };
  return {
    channel,
    async deliver(payload: unknown, key: string) {
      receive?.({ content: Buffer.from(JSON.stringify(payload)), fields: { routingKey: key }, properties: { headers: {} } });
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

describe("RF8.6 - eventos M5 acordados", () => {
  it("valida los tres ejemplos con sus correlaciones", () => {
    expect(parseM5TripEventEnvelope(Buffer.from(JSON.stringify(base)), "ride.requested").eventType).toBe("TripRequested");
    expect(parseM5TripEventEnvelope(Buffer.from(JSON.stringify(accepted)), "driver.offer.accepted").eventType).toBe("DriverAssigned");
    expect(parseM5TripEventEnvelope(Buffer.from(JSON.stringify(cancelled)), "ride_request.cancelled").eventType).toBe("TripCancelled");
  });

  it("rechaza identidad de texto, correlacion incorrecta y viaje inventado en la cancelacion", () => {
    expect(() => parseM5TripEventEnvelope(Buffer.from(JSON.stringify({ ...base, data: { ...base.data, clientUserId: "105" } })), "ride.requested")).toThrow("clientUserId");
    expect(() => parseM5TripEventEnvelope(Buffer.from(JSON.stringify({ ...accepted, correlationId: rideRequestId })), "driver.offer.accepted")).toThrow("correlationId");
    expect(() => parseM5TripEventEnvelope(Buffer.from(JSON.stringify({ ...cancelled, data: { ...cancelled.data, tripId } })), "ride_request.cancelled")).toThrow("tripId");
    expect(() => parseM5TripEventEnvelope(Buffer.from(JSON.stringify({ ...accepted, data: { ...accepted.data, vehicleType: undefined } })), "driver.offer.accepted")).toThrow("vehiculo");
  });

  it("declara bindings durables, deduplica redelivery y envia invalidos a DLQ", async () => {
    const rabbit = broker();
    const deliver = vi.fn().mockResolvedValue(undefined);
    const consumer = new M5TripEventsConsumer({
      connection: { createConfirmChannel: vi.fn().mockResolvedValue(rabbit.channel) } as any,
      inboxStore: new InMemoryTechnicalInbox(),
      deliverToRf81: deliver,
      maxRetries: 0,
    });
    await consumer.start();
    for (const key of Object.keys({ "ride.requested": 1, "driver.offer.accepted": 1, "ride_request.cancelled": 1 })) {
      expect(rabbit.channel.bindQueue).toHaveBeenCalledWith(M5_TRIP_EVENTS_QUEUE, "mobility.events", key);
    }
    expect(rabbit.channel.assertQueue).toHaveBeenCalledWith(M5_TRIP_EVENTS_QUEUE, expect.objectContaining({ durable: true }));
    await rabbit.deliver(base, "ride.requested");
    await rabbit.deliver(base, "ride.requested");
    await rabbit.deliver({ ...accepted, correlationId: rideRequestId }, "driver.offer.accepted");
    await rabbit.deliver(accepted, "driver.offer.accepted");
    await rabbit.deliver(cancelled, "ride_request.cancelled");
    expect(deliver).toHaveBeenCalledTimes(3);
    expect(rabbit.channel.publish).toHaveBeenCalledWith(
      "mobility.events.dlx", M5_TRIP_EVENTS_QUEUE, expect.any(Buffer), expect.any(Object), expect.any(Function),
    );
    await consumer.stop();
  });
});

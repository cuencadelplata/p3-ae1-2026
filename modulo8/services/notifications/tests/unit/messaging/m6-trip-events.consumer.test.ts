import { describe, expect, it, vi } from "vitest";
import { InMemoryTechnicalInbox } from "@m8/shared";

import {
  M6TripEventsConsumer,
  M6_TRIP_EVENTS_QUEUE,
  parseM6TripEventEnvelope,
} from "../../../src/messaging/m6-trip-events.consumer";

const arrived = {
  messageId: "c0a80123-4567-489a-8abc-1234567890ab",
  eventType: "DriverArrived",
  version: 1,
  occurredAt: "2026-11-16T20:30:00.000Z",
  correlationId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  producer: "m6",
  data: { tripId: "3fa85f64-5717-4562-b3fc-2c963f66afa6", recipientId: 42 },
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
      return { consumerTag: "m6-trip-events" };
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
      receive?.({
        content: Buffer.from(JSON.stringify(payload)),
        fields: { routingKey: key },
        properties: { headers: {} },
      });
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function createConsumer(channel: unknown, deliverToRf81: any) {
  return new M6TripEventsConsumer({
    connection: { createConfirmChannel: vi.fn().mockResolvedValue(channel) } as any,
    inboxStore: new InMemoryTechnicalInbox(),
    deliverToRf81,
    maxRetries: 0,
  });
}

describe("RF8.6 - eventos DriverArrived y TripStarted de M6", () => {
  it("declara los dos bindings en una cola durable", async () => {
    const rabbit = broker();
    await createConsumer(rabbit.channel, vi.fn()).start();
    expect(rabbit.channel.assertQueue).toHaveBeenCalledWith(M6_TRIP_EVENTS_QUEUE, expect.objectContaining({ durable: true }));
    expect(rabbit.channel.bindQueue).toHaveBeenCalledWith(M6_TRIP_EVENTS_QUEUE, "mobility.events", "driver.arrived");
    expect(rabbit.channel.bindQueue).toHaveBeenCalledWith(M6_TRIP_EVENTS_QUEUE, "mobility.events", "trip.started");
    expect(rabbit.channel.bindQueue).toHaveBeenCalledWith(M6_TRIP_EVENTS_QUEUE, "mobility.events", "trip.completed");
    expect(rabbit.channel.bindQueue).toHaveBeenCalledWith(M6_TRIP_EVENTS_QUEUE, "mobility.events", "trip.cancelled");
  });

  it("acepta TripCancelled de M6 para el cliente y para el conductor", async () => {
    const cancelled = (messageId: string, recipientId: number) => ({
      messageId,
      eventType: "TripCancelled",
      version: 1,
      occurredAt: "2026-11-16T21:10:00.000Z",
      correlationId: arrived.data.tripId,
      producer: "m6-viajes",
      data: { tripId: arrived.data.tripId, recipientId, cancelledBy: "cliente", motivo: "Ya no lo necesito" },
    });
    const rabbit = broker();
    const deliver = vi.fn().mockResolvedValue({ status: "SUCCESS_CREATED", valid: true, created: true, data: {} });
    await createConsumer(rabbit.channel, deliver).start();
    await rabbit.deliver(cancelled("c0a80123-4567-489a-8abc-000000000001", 42), "trip.cancelled");
    await rabbit.deliver(cancelled("c0a80123-4567-489a-8abc-000000000002", 7), "trip.cancelled");
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ eventType: "TripCancelled", data: expect.objectContaining({ recipientId: 7 }) }));
  });

  it("acepta el TripCompleted que M6 publica desde su outbox (producer m6-viajes)", async () => {
    // Forma exacta de modulo6/src/rf-6.1-6.2-6.3/services/eventos-viaje.service.ts
    const completed = {
      messageId: "c0a80123-4567-489a-8abc-fedcba987654",
      eventType: "TripCompleted",
      version: 1,
      occurredAt: "2026-11-16T21:05:00.000Z",
      correlationId: arrived.data.tripId,
      producer: "m6-viajes",
      data: { tripId: arrived.data.tripId, recipientId: 42, total: 2365, paymentId: "pago-1" },
    };
    expect(parseM6TripEventEnvelope(Buffer.from(JSON.stringify(completed)), "trip.completed").eventType).toBe("TripCompleted");

    const rabbit = broker();
    const deliver = vi.fn().mockResolvedValue({ status: "SUCCESS_CREATED", valid: true, created: true, data: {} });
    await createConsumer(rabbit.channel, deliver).start();
    await rabbit.deliver(completed, "trip.completed");
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ eventType: "TripCompleted" }));
  });

  it("procesa los dos tipos una sola vez por messageId", async () => {
    const rabbit = broker();
    const deliver = vi.fn().mockResolvedValue({ status: "SUCCESS_CREATED", valid: true, created: true, data: {} });
    await createConsumer(rabbit.channel, deliver).start();
    await rabbit.deliver(arrived, "driver.arrived");
    await rabbit.deliver(arrived, "driver.arrived");
    await rabbit.deliver({ ...arrived, messageId: "c0a80123-4567-489a-8abc-abcdef123456", eventType: "TripStarted", occurredAt: "2026-11-16T20:35:00.000Z" }, "trip.started");
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ data: { tripId: arrived.data.tripId, recipientId: 42 } }));
    expect(rabbit.channel.ack).toHaveBeenCalledTimes(3);
  });

  it("rechaza un destinatario de texto y un tipo que no coincide con la routing key", () => {
    expect(() => parseM6TripEventEnvelope(Buffer.from(JSON.stringify({ ...arrived, data: { tripId: arrived.data.tripId, recipientId: "42" } })), "driver.arrived")).toThrow("recipientId");
    expect(() => parseM6TripEventEnvelope(Buffer.from(JSON.stringify(arrived)), "trip.started")).toThrow("routing key");
    expect(() => parseM6TripEventEnvelope(Buffer.from(JSON.stringify({ ...arrived, producer: "otro" })), "driver.arrived")).toThrow("producer");
  });

  it("envia un evento invalido a DLQ y sigue consumiendo el siguiente", async () => {
    const rabbit = broker();
    const deliver = vi.fn().mockResolvedValue({ status: "SUCCESS_CREATED", valid: true, created: true, data: {} });
    await createConsumer(rabbit.channel, deliver).start();
    await rabbit.deliver({ ...arrived, data: { tripId: arrived.data.tripId, recipientId: "42" } }, "driver.arrived");
    await rabbit.deliver(arrived, "driver.arrived");
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(rabbit.channel.publish).toHaveBeenCalledWith(
      "mobility.events.dlx", M6_TRIP_EVENTS_QUEUE, expect.any(Buffer), expect.any(Object), expect.any(Function),
    );
  });
});

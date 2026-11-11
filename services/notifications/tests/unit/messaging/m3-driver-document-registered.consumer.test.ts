import { describe, expect, it, vi } from "vitest";
import { InMemoryTechnicalInbox } from "@m8/shared";

import {
  M3_DOCUMENT_REGISTERED_QUEUE,
  M3_DOCUMENTS_EXCHANGE,
  M3DriverDocumentRegisteredConsumer,
  parseM3DriverDocumentRegisteredEnvelope,
} from "../../../src/messaging/m3-driver-document-registered.consumer";

const event = {
  messageId: "a1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d",
  eventType: "DriverDocumentRegistered",
  version: 1,
  occurredAt: "2026-10-11T23:04:00.000Z",
  correlationId: "f1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d",
  producer: "m3-conductores",
  data: {
    documentId: "f1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d",
    driverId: 42,
    tipoDocumento: "LICENCIA",
  },
};

function success() {
  return {
    status: "SUCCESS_CREATED" as const,
    valid: true as const,
    created: true,
    data: {},
  };
}

function createBroker() {
  let callback: ((message: any) => void) | undefined;
  const listeners = new Map<string, () => void>();
  const channel = {
    on: vi.fn((name: string, listener: () => void) => { listeners.set(name, listener); }),
    assertExchange: vi.fn().mockResolvedValue({}),
    assertQueue: vi.fn().mockResolvedValue({}),
    bindQueue: vi.fn().mockResolvedValue({}),
    consume: vi.fn(async (_queue: string, received: (message: any) => void) => {
      callback = received;
      return { consumerTag: "m3-documents" };
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ack: vi.fn(),
    publish: vi.fn((_exchange: string, _key: string, _content: Buffer, _options: unknown, confirmed: () => void) => {
      confirmed();
      return true;
    }),
    waitForConfirms: vi.fn().mockResolvedValue(undefined),
  };
  return { channel, emit(name: string) { listeners.get(name)?.(); }, get callback() { return callback; } };
}

async function deliver(callback: ((message: any) => void) | undefined, payload: unknown): Promise<void> {
  callback?.({
    content: Buffer.from(JSON.stringify(payload)),
    fields: { routingKey: "documento.registrado" },
    properties: { headers: {} },
  });
  await new Promise((resolve) => setImmediate(resolve));
}

describe("RF8.6 - consumidor M3 documento.registrado", () => {
  it("marca el consumer como no disponible al cerrarse el canal", async () => {
    const broker = createBroker();
    const onDisconnected = vi.fn();
    const consumer = new M3DriverDocumentRegisteredConsumer({
      connection: { createConfirmChannel: vi.fn().mockResolvedValue(broker.channel) } as any,
      inboxStore: new InMemoryTechnicalInbox(),
      deliverToRf81: vi.fn().mockResolvedValue(success()),
      onDisconnected,
    });
    await consumer.start();
    expect(consumer.isReady()).toBe(true);
    broker.emit("close");
    expect(consumer.isReady()).toBe(false);
    expect(onDisconnected).toHaveBeenCalledOnce();
  });

  it("declara el exchange, la cola y el binding externos acordados", async () => {
    const broker = createBroker();
    const consumer = new M3DriverDocumentRegisteredConsumer({
      connection: { createConfirmChannel: vi.fn().mockResolvedValue(broker.channel) } as any,
      inboxStore: new InMemoryTechnicalInbox(),
      deliverToRf81: vi.fn().mockResolvedValue(success()),
    });

    await consumer.start();

    expect(broker.channel.assertExchange).toHaveBeenCalledWith(M3_DOCUMENTS_EXCHANGE, "topic", { durable: true });
    expect(broker.channel.assertQueue).toHaveBeenCalledWith(M3_DOCUMENT_REGISTERED_QUEUE, expect.objectContaining({ durable: true }));
    expect(broker.channel.bindQueue).toHaveBeenCalledWith(
      M3_DOCUMENT_REGISTERED_QUEUE,
      M3_DOCUMENTS_EXCHANGE,
      "documento.registrado",
    );
  });

  it("valida el envelope y lo entrega una vez a RF8.1", async () => {
    const broker = createBroker();
    const deliverToRf81 = vi.fn().mockResolvedValue(success());
    const consumer = new M3DriverDocumentRegisteredConsumer({
      connection: { createConfirmChannel: vi.fn().mockResolvedValue(broker.channel) } as any,
      inboxStore: new InMemoryTechnicalInbox(),
      deliverToRf81,
    });
    await consumer.start();

    await deliver(broker.callback, event);
    await deliver(broker.callback, event);

    expect(deliverToRf81).toHaveBeenCalledTimes(1);
    expect(deliverToRf81).toHaveBeenCalledWith(expect.objectContaining({
      documentId: event.data.documentId,
      driverId: 42,
      tipoDocumento: "LICENCIA",
    }));
    expect(broker.channel.ack).toHaveBeenCalledTimes(2);
  });

  it("envía un envelope inválido a DLQ sin derribar el consumidor", async () => {
    const broker = createBroker();
    const deliverToRf81 = vi.fn().mockResolvedValue(success());
    const consumer = new M3DriverDocumentRegisteredConsumer({
      connection: { createConfirmChannel: vi.fn().mockResolvedValue(broker.channel) } as any,
      inboxStore: new InMemoryTechnicalInbox(),
      deliverToRf81,
    });
    await consumer.start();

    await deliver(broker.callback, { ...event, producer: "otro-productor" });
    await deliver(broker.callback, event);

    expect(deliverToRf81).toHaveBeenCalledTimes(1);
    expect(broker.channel.publish).toHaveBeenCalledWith(
      "mobility.events.dlx",
      M3_DOCUMENT_REGISTERED_QUEUE,
      expect.any(Buffer),
      expect.objectContaining({ headers: expect.objectContaining({ "x-dlq-reason": expect.any(String) }) }),
      expect.any(Function),
    );
  });

  it("reintenta una falla de RF8.1 y sigue con mensajes posteriores", async () => {
    const broker = createBroker();
    const deliverToRf81 = vi.fn()
      .mockRejectedValueOnce(new Error("PostgreSQL temporalmente no disponible"))
      .mockResolvedValue(success());
    const consumer = new M3DriverDocumentRegisteredConsumer({
      connection: { createConfirmChannel: vi.fn().mockResolvedValue(broker.channel) } as any,
      inboxStore: new InMemoryTechnicalInbox(),
      deliverToRf81,
    });
    await consumer.start();

    await deliver(broker.callback, event);
    await deliver(broker.callback, { ...event, messageId: "b1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d" });

    expect(broker.channel.publish).toHaveBeenCalledWith(
      "",
      `${M3_DOCUMENT_REGISTERED_QUEUE}.retry`,
      expect.any(Buffer),
      expect.objectContaining({ headers: expect.objectContaining({ "x-retry-count": 1 }) }),
      expect.any(Function),
    );
    expect(deliverToRf81).toHaveBeenCalledTimes(2);
  });

  it("deriva a DLQ una falla de RF8.1 cuando se agotan los reintentos", async () => {
    const broker = createBroker();
    const consumer = new M3DriverDocumentRegisteredConsumer({
      connection: { createConfirmChannel: vi.fn().mockResolvedValue(broker.channel) } as any,
      inboxStore: new InMemoryTechnicalInbox(),
      deliverToRf81: vi.fn().mockRejectedValue(new Error("Falla persistente de RF8.1")),
      maxRetries: 0,
    });
    await consumer.start();

    await deliver(broker.callback, event);

    expect(broker.channel.publish).toHaveBeenCalledWith(
      "mobility.events.dlx",
      M3_DOCUMENT_REGISTERED_QUEUE,
      expect.any(Buffer),
      expect.objectContaining({ headers: expect.objectContaining({ "x-dlq-reason": "Falla persistente de RF8.1" }) }),
      expect.any(Function),
    );
  });

  it("rechaza los campos obligatorios del contrato sin generar un messageId", () => {
    expect(() => parseM3DriverDocumentRegisteredEnvelope(Buffer.from(JSON.stringify({ ...event, messageId: undefined })))).toThrow(
      "messageId",
    );
  });

  it("rechaza el JSON plano que publica la versión auditada de M3", () => {
    const oldPayload = {
      documentId: event.data.documentId,
      driverId: "driver-test-42",
      tipoDocumento: "LICENCIA_CONDUCIR",
      timestamp: event.occurredAt,
    };
    expect(() => parseM3DriverDocumentRegisteredEnvelope(Buffer.from(JSON.stringify(oldPayload)))).toThrow("messageId");
  });

  it("rechaza un driverId que no es un userId numérico seguro de M1", () => {
    for (const driverId of [event.data.documentId, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseM3DriverDocumentRegisteredEnvelope(Buffer.from(JSON.stringify({
        ...event,
        data: { ...event.data, driverId },
      })))).toThrow("data.driverId");
    }
  });
});

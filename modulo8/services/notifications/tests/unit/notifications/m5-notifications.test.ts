import { describe, expect, it, vi } from "vitest";
import type { NotificationWithOutboxRepository } from "../../../src/notifications/notification-outbox.repository";
import type { LogicalNotification } from "../../../src/notifications/notification.types";
import { createRf81Application } from "../../../src/notifications/rf81-application";
import { createNotificationRequestedData } from "../../../src/notifications/notification-requested.mapper";
import { parseM5TripEventEnvelope } from "../../../src/messaging/m5-trip-events.consumer";

const requestId = "req_550e8400-e29b-41d4-a716-446655440000";
const tripId = "viaje_m6_849201";
const common = {
  version: 1,
  occurredAt: "2026-11-17T12:30:00.000Z",
  producer: "m5",
};

function event(value: Record<string, unknown>, key: string) {
  return parseM5TripEventEnvelope(Buffer.from(JSON.stringify(value)), key);
}

function fakeRepository() {
  const stored = new Map<string, LogicalNotification>();
  const saveWithOutbox = vi.fn(async (notification: LogicalNotification) => {
    const key = `${notification.sourceMessageId}:${notification.recipientId}`;
    const existing = stored.get(key);
    if (!existing) stored.set(key, notification);
    return { notification: existing ?? notification, created: !existing, outbox: {} as any };
  });
  const repository = {
    saveWithOutbox,
    saveWithOutboxUsingClient: vi.fn(),
    findPending: vi.fn(async () => []),
    claimPendingForPublish: vi.fn(async () => []),
    markPublished: vi.fn(async () => true),
    markPublishedWithClient: vi.fn(async () => true),
  } as NotificationWithOutboxRepository;
  return { repository, stored, saveWithOutbox };
}

describe("RF8.1 - notificaciones a partir de M5", () => {
  it("agrega al aviso del cliente el nombre de M1 y el vehículo de M3", async () => {
    const fake = fakeRepository();
    const driverNameLookup = vi.fn().mockResolvedValue("Carlos Gómez");
    const activeVehicleLookup = vi.fn().mockResolvedValue({ patente: "AB123CD", marca: "Toyota", modelo: "Corolla" });
    const app = createRf81Application({ repository: fake.repository, driverNameLookup, activeVehicleLookup });
    const accepted = event({
      ...common,
      messageId: "550e8400-e29b-41d4-a716-446655440000",
      eventType: "driver.offer.accepted",
      correlationId: tripId,
      data: {
        rideRequestId: requestId, tripId, offerId: "off_1", clientUserId: 105, driverUserId: 42,
        vehicleType: "AUTO",
        origin: { latitude: -34.6037, longitude: -58.3816, address: "Origen" },
        destination: { latitude: -34.5885, longitude: -58.3974, address: "Destino" },
        fare: { amount: 2850.50, currency: "ARS" },
      },
    }, "driver.offer.accepted");
    await app.processM5EventEnvelope(accepted);
    expect(driverNameLookup).toHaveBeenCalledWith(42);
    expect(activeVehicleLookup).toHaveBeenCalledWith(42, "AUTO");
    expect(fake.stored.get(`${accepted.messageId}:105`)?.message).toContain("Carlos Gómez");
    expect(fake.stored.get(`${accepted.messageId}:105`)?.message).toContain("Toyota Corolla, patente AB123CD");
    expect(fake.stored.get(`${accepted.messageId}:42`)?.message).not.toContain("Carlos Gómez");
    expect(fake.stored.get(`${accepted.messageId}:42`)?.message).not.toContain("AB123CD");
  });

  it("crea una notificacion por cada destinatario de la asignacion y es idempotente", async () => {
    const fake = fakeRepository();
    const app = createRf81Application({ repository: fake.repository });
    const accepted = event({
      ...common,
      messageId: "d9f528e3-8c35-4e3f-959f-39f10e95cf02",
      eventType: "driver.offer.accepted",
      correlationId: tripId,
      data: {
        rideRequestId: requestId, tripId, offerId: "off_1", clientUserId: 105, driverUserId: 42,
        vehicleType: "AUTO",
        origin: { latitude: -34.6037, longitude: -58.3816, address: "Origen" },
        destination: { latitude: -34.5885, longitude: -58.3974, address: "Destino" },
        fare: { amount: 2850.50, currency: "ARS" },
      },
    }, "driver.offer.accepted");
    await app.processM5EventEnvelope(accepted);
    await app.processM5EventEnvelope(accepted);
    expect(fake.stored.size).toBe(2);
    expect([...fake.stored.values()].map((n) => n.recipientId).sort((a, b) => Number(a) - Number(b))).toEqual([42, 105]);
    expect([...fake.stored.values()].map((n) => n.title)).toEqual(["Conductor asignado", "Viaje asignado"]);
    expect([...fake.stored.values()].map((n) => createNotificationRequestedData(n).title)).toEqual([
      "Conductor asignado", "Viaje asignado",
    ]);
    expect([...fake.stored.values()].every((n) => n.tripId === tripId && n.rideRequestId === requestId)).toBe(true);
    expect([...fake.stored.values()].every((n) => n.message.includes("auto") && n.message.includes("Origen") && n.message.includes("Destino"))).toBe(true);
  });

  it("cancela la solicitud solo para el cliente y conserva rideRequestId sin tripId", async () => {
    const fake = fakeRepository();
    const app = createRf81Application({ repository: fake.repository });
    const cancelled = event({
      ...common,
      messageId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      eventType: "ride_request.cancelled",
      correlationId: requestId,
      data: { rideRequestId: requestId, clientUserId: 105 },
    }, "ride_request.cancelled");
    await app.processM5EventEnvelope(cancelled);
    const notification = [...fake.stored.values()][0];
    expect(fake.stored.size).toBe(1);
    expect(notification).toMatchObject({
      recipientId: 105,
      tripId: null,
      rideRequestId: requestId,
      correlationId: requestId,
      eventType: "TripCancelled",
    });
  });
});

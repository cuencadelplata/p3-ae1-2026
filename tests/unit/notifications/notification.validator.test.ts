/*
 * RF-8.1 — Pruebas unitarias del validador de notificaciones.
 * Verifican el cuerpo permitido, eventos, canales y detalles de error sin HTTP.
 */
import { describe, expect, it } from "vitest";

import { EVENT_TYPES } from "../../../src/notifications/notification.types";
import { validateNotificationRequest } from "../../../src/notifications/notification.validator";

const validRequest = {
  tripId: "trip-123",
  recipientId: "user-456",
  eventType: "DRIVER_ASSIGNED",
  channels: ["PUSH"],
};

describe("RF-8.1 — validateNotificationRequest", () => {
  it("acepta una solicitud válida y completa", () => {
    const result = validateNotificationRequest(validRequest);

    expect(result).toEqual({ valid: true, data: validRequest });
  });

  it.each(EVENT_TYPES)("accepts eventType %s", (eventType) => {
    const result = validateNotificationRequest({ ...validRequest, eventType });

    expect(result.valid).toBe(true);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a non-object value", "request"],
  ])("rejects %s as a body", (_description, body) => {
    const result = validateNotificationRequest(body);

    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.details).toContainEqual(expect.objectContaining({ field: "body" }));
    }
  });

  it.each([
    ["is missing", { ...validRequest, tripId: undefined }],
    ["is not a string", { ...validRequest, tripId: 42 }],
    ["is empty", { ...validRequest, tripId: "" }],
  ])("rejects tripId when it %s", (_description, body) => {
    const result = validateNotificationRequest(body);

    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.details).toContainEqual(expect.objectContaining({ field: "tripId" }));
    }
  });

  it.each([
    ["is missing", { ...validRequest, recipientId: undefined }],
    ["is not a string", { ...validRequest, recipientId: 42 }],
    ["is empty", { ...validRequest, recipientId: "" }],
  ])("rejects recipientId when it %s", (_description, body) => {
    const result = validateNotificationRequest(body);

    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.details).toContainEqual(expect.objectContaining({ field: "recipientId" }));
    }
  });

  it("rechaza un eventType no soportado", () => {
    const result = validateNotificationRequest({ ...validRequest, eventType: "UNKNOWN" });

    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.details).toContainEqual(expect.objectContaining({ field: "eventType" }));
    }
  });

  it.each([
    ["is not an array", { ...validRequest, channels: "PUSH" }, "channels"],
    ["is empty", { ...validRequest, channels: [] }, "channels"],
    ["contains an unsupported value", { ...validRequest, channels: ["EMAIL"] }, "channels[0]"],
    ["contains duplicate values", { ...validRequest, channels: ["PUSH", "PUSH"] }, "channels"],
  ])("rejects channels when it %s", (_description, body, field) => {
    const result = validateNotificationRequest(body);

    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.details).toContainEqual(expect.objectContaining({ field }));
    }
  });

  it("rechaza una propiedad adicional", () => {
    const result = validateNotificationRequest({ ...validRequest, extra: true });

    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.details).toContainEqual(expect.objectContaining({ field: "extra" }));
    }
  });

  it.each([undefined, 1, true])("rejects non-object body %j", (body) => {
    expect(validateNotificationRequest(body)).toMatchObject({ valid: false });
  });

  it("acepta IDs con espacios o un carácter sin normalizarlos", () => {
    const input = { ...validRequest, tripId: " ", recipientId: "x" };

    expect(validateNotificationRequest(input)).toEqual({ valid: true, data: input });
  });

  it.each([
    ["missing tripId", (({ tripId: _value, ...body }) => body)(validRequest), "tripId"],
    ["null tripId", { ...validRequest, tripId: null }, "tripId"],
    ["boolean tripId", { ...validRequest, tripId: false }, "tripId"],
    ["missing recipientId", (({ recipientId: _value, ...body }) => body)(validRequest), "recipientId"],
    ["null recipientId", { ...validRequest, recipientId: null }, "recipientId"],
    ["boolean recipientId", { ...validRequest, recipientId: false }, "recipientId"],
    ["missing eventType", (({ eventType: _value, ...body }) => body)(validRequest), "eventType"],
    ["null eventType", { ...validRequest, eventType: null }, "eventType"],
    ["numeric eventType", { ...validRequest, eventType: 1 }, "eventType"],
    ["empty eventType", { ...validRequest, eventType: "" }, "eventType"],
    ["missing channels", (({ channels: _value, ...body }) => body)(validRequest), "channels"],
    ["null channels", { ...validRequest, channels: null }, "channels"],
    ["object channels", { ...validRequest, channels: {} }, "channels"],
    ["SMS channel", { ...validRequest, channels: ["SMS"] }, "channels[0]"],
    ["null channel", { ...validRequest, channels: [null] }, "channels[0]"],
    ["numeric channel", { ...validRequest, channels: [42] }, "channels[0]"],
    ["mixed channels", { ...validRequest, channels: ["PUSH", "EMAIL"] }, "channels[1]"],
  ])("rejects %s", (_description, body, field) => {
    const result = validateNotificationRequest(body);

    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.details).toContainEqual(expect.objectContaining({ field }));
  });

  it("acumula detalles y no modifica la entrada", () => {
    const input: Record<string, unknown> = {
      tripId: "", recipientId: null, eventType: "UNKNOWN", channels: ["PUSH", "PUSH"], extra: true, other: true,
    };
    const snapshot = structuredClone(input);
    const result = validateNotificationRequest(input);

    expect(result).toMatchObject({ valid: false });
    if (!result.valid) expect(result.details.map(({ field }) => field)).toEqual(expect.arrayContaining(["tripId", "recipientId", "eventType", "channels", "extra", "other"]));
    expect(input).toEqual(snapshot);
  });
});

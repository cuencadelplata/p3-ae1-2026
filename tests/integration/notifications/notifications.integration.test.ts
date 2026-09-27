/*
 * RF-8.1 — Pruebas de integración de POST /notifications y recursos públicos.
 * Verifican contrato HTTP, errores y composición Express con Supertest.
 */
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { app, createApp } from "../../../src/app";
import type { PushProvider } from "../../../src/notifications/push-provider";

const successfulPushProvider: PushProvider = { async send() {} };

const validRequest = {
  tripId: "trip-123",
  recipientId: "user-456",
  eventType: "DRIVER_ASSIGNED",
  channels: ["PUSH"],
};

describe("RF-8.1 — POST /notifications", () => {
  it("responde 201 ante una solicitud válida con charset JSON", async () => {
    const response = await request(createApp(successfulPushProvider))
      .post("/notifications")
      .set("Content-Type", "application/json; charset=utf-8")
      .send(validRequest);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      tripId: validRequest.tripId,
      recipientId: validRequest.recipientId,
      eventType: validRequest.eventType,
      channels: validRequest.channels,
      message: "Se asignó un conductor a tu viaje.",
      status: "PROCESSED",
    });
    expect(response.body.notificationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(response.body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it.each([
    ["eventType is invalid", { ...validRequest, eventType: "UNKNOWN" }],
    ["an additional property is supplied", { ...validRequest, extra: true }],
    ["channels is empty", { ...validRequest, channels: [] }],
  ])("returns 400 VALIDATION_ERROR when %s", async (_description, body) => {
    const response = await request(createApp(successfulPushProvider))
      .post("/notifications")
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "La solicitud contiene datos inválidos.",
      },
    });
    expect(response.body.error.details).toEqual(expect.any(Array));
  });

  it("responde 400 VALIDATION_ERROR ante JSON malformado", async () => {
    const response = await request(createApp(successfulPushProvider))
      .post("/notifications")
      .set("Content-Type", "application/json")
      .send('{"tripId":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("responde 415 UNSUPPORTED_MEDIA_TYPE para text/plain", async () => {
    const response = await request(createApp(successfulPushProvider))
      .post("/notifications")
      .set("Content-Type", "text/plain")
      .send("not JSON");

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it.each([
    ["application/xml", "application/xml"],
    ["a missing Content-Type", undefined],
  ])("returns 415 for %s", async (_description, contentType) => {
    let call = request(createApp(successfulPushProvider)).post("/notifications");
    if (contentType) call = call.set("Content-Type", contentType);
    const response = await call.send("payload");

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it.each([
    ["empty object", {}],
    ["null", null],
    ["array", []],
    ["missing tripId", { recipientId: "user", eventType: "TRIP_STARTED", channels: ["PUSH"] }],
    ["empty tripId", { ...validRequest, tripId: "" }],
    ["missing recipientId", { tripId: "trip", eventType: "TRIP_STARTED", channels: ["PUSH"] }],
    ["empty recipientId", { ...validRequest, recipientId: "" }],
    ["missing eventType", { tripId: "trip", recipientId: "user", channels: ["PUSH"] }],
    ["missing channels", { tripId: "trip", recipientId: "user", eventType: "TRIP_STARTED" }],
    ["non-array channels", { ...validRequest, channels: "PUSH" }],
    ["EMAIL channels", { ...validRequest, channels: ["EMAIL"] }],
    ["numeric channels", { ...validRequest, channels: [1] }],
    ["duplicate channels", { ...validRequest, channels: ["PUSH", "PUSH"] }],
  ])("returns 400 for %s", async (_description, body) => {
    const response = await request(createApp(successfulPushProvider))
      .post("/notifications")
      .set("Content-Type", "application/json")
      .send(body === null ? "null" : body);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: "VALIDATION_ERROR", message: "La solicitud contiene datos inválidos." });
    expect(response.body.error.details).toEqual(expect.any(Array));
  });

  it("no invoca al proveedor para solicitudes inválidas", async () => {
    const send = vi.fn(async () => {});
    const response = await request(createApp({ send })).post("/notifications").send({ ...validRequest, eventType: "UNKNOWN" });

    expect(response.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("no invoca al proveedor ante JSON malformado o media type inválido", async () => {
    const send = vi.fn(async () => {});
    const testApp = createApp({ send });

    await request(testApp).post("/notifications").set("Content-Type", "application/json").send('{"tripId":').expect(400);
    await request(testApp).post("/notifications").set("Content-Type", "text/plain").send("not json").expect(415);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["TRIP_REQUESTED", "Tu solicitud de viaje fue recibida."],
    ["DRIVER_ASSIGNED", "Se asignó un conductor a tu viaje."],
    ["DRIVER_ARRIVED", "Tu conductor ha llegado al punto de encuentro."],
    ["TRIP_STARTED", "Tu viaje ha comenzado."],
    ["TRIP_CANCELLED", "Tu viaje fue cancelado."],
    ["TRIP_COMPLETED", "Tu viaje ha finalizado."],
  ])("processes %s through HTTP", async (eventType, message) => {
    const response = await request(createApp(successfulPushProvider)).post("/notifications").send({ ...validRequest, eventType });

    expect(response.status).toBe(201);
    expect(response.body.message).toBe(message);
  });

  it("usa la composición real de AE1 con mockPushProvider", async () => {
    const response = await request(app).post("/notifications").send(validRequest);

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("PROCESSED");
  });

  it("responde 500 seguro cuando falla el proveedor PUSH", async () => {
    const failingPushProvider: PushProvider = {
      async send() {
        throw new Error("internal provider failure");
      },
    };

    const response = await request(createApp(failingPushProvider))
      .post("/notifications")
      .send(validRequest);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: "NOTIFICATION_PROCESSING_ERROR",
        message: "No fue posible procesar la notificación.",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("internal provider failure");
    expect(JSON.stringify(response.body)).not.toContain("stack");
  });

  it.each(["non-object failure", null])(
    "returns a safe 500 response for a provider rejection of %j",
    async (failure) => {
      const failingPushProvider: PushProvider = {
        send: () => Promise.reject(failure),
      };

      const response = await request(createApp(failingPushProvider))
        .post("/notifications")
        .send(validRequest);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: {
          code: "NOTIFICATION_PROCESSING_ERROR",
          message: "No fue posible procesar la notificación.",
        },
      });
    },
  );

  it("reconoce un error de parseo representado mediante statusCode", async () => {
    const parseErrorProvider: PushProvider = {
      send: () => Promise.reject({ type: "entity.parse.failed", statusCode: 400 }),
    };

    const response = await request(createApp(parseErrorProvider))
      .post("/notifications")
      .send(validRequest);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "La solicitud contiene datos inválidos.",
    });
  });
});

describe("recursos públicos", () => {
  it("sirve la interfaz de demostración integrada RF-8.1 y RF-8.2", async () => {
    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("M8 - Notificaciones");
    expect(response.text).toContain("notification-form");
    expect(response.text).toContain("RF-8.2 — Verificación QR");
    expect(response.text).toContain("qr-generation-form");
    expect(response.text).toContain("qr-image");
    expect(response.text).toContain("qr-countdown");
    expect(response.text).toContain("validate-qr-button");
    expect(response.text).toContain("/styles.css");
    expect(response.text).toContain("/app.js");
    expect(response.text).toContain("/openapi.yaml");
  });

  it("sirve la hoja de estilos de la interfaz", async () => {
    const response = await request(app).get("/styles.css");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/css");
    expect(response.text.length).toBeGreaterThan(0);
  });

  it("sirve el script de la interfaz", async () => {
    const response = await request(app).get("/app.js");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("javascript");
    expect(response.text.length).toBeGreaterThan(0);
    expect(response.text).toContain("/notifications");
    expect(response.text).toContain("/qr");
    expect(response.text).toContain("/qr/validate");
  });

  it("sirve el contrato OpenAPI aprobado", async () => {
    const response = await request(app).get("/openapi.yaml");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("yaml");
    expect(response.text).toContain("openapi: 3.0.3");
    expect(response.text).toContain("/notifications");
    expect(response.text).toContain("post:");
  });
});

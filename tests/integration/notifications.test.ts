import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { app, createApp } from "../../src/app";
import type { PushProvider } from "../../src/notifications/push-provider";

const successfulPushProvider: PushProvider = { async send() {} };

const validRequest = {
  tripId: "trip-123",
  recipientId: "user-456",
  eventType: "DRIVER_ASSIGNED",
  channels: ["PUSH"],
};

describe("POST /notifications", () => {
  it("returns 201 for a valid request with a JSON charset", async () => {
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

  it("returns 400 VALIDATION_ERROR for malformed JSON", async () => {
    const response = await request(createApp(successfulPushProvider))
      .post("/notifications")
      .set("Content-Type", "application/json")
      .send('{"tripId":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 415 UNSUPPORTED_MEDIA_TYPE for text/plain", async () => {
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

  it("does not invoke the provider for invalid requests", async () => {
    const send = vi.fn(async () => {});
    const response = await request(createApp({ send })).post("/notifications").send({ ...validRequest, eventType: "UNKNOWN" });

    expect(response.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not invoke the provider for malformed JSON or an invalid media type", async () => {
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

  it("uses the real AE1 composition with mockPushProvider", async () => {
    const response = await request(app).post("/notifications").send(validRequest);

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("PROCESSED");
  });

  it("returns a safe 500 response when the push provider fails", async () => {
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

  it("recognizes a parse error represented with statusCode", async () => {
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
  it("serves the integrated RF-8.1 and RF-8.2 demonstration UI", async () => {
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

  it("serves the UI stylesheet", async () => {
    const response = await request(app).get("/styles.css");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/css");
    expect(response.text.length).toBeGreaterThan(0);
  });

  it("serves the UI script", async () => {
    const response = await request(app).get("/app.js");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("javascript");
    expect(response.text.length).toBeGreaterThan(0);
    expect(response.text).toContain("/notifications");
    expect(response.text).toContain("/qr");
    expect(response.text).toContain("/qr/validate");
  });

  it("serves the approved OpenAPI contract", async () => {
    const response = await request(app).get("/openapi.yaml");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("yaml");
    expect(response.text).toContain("openapi: 3.0.3");
    expect(response.text).toContain("/notifications");
    expect(response.text).toContain("post:");
  });
});

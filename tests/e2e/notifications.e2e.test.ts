import { describe, expect, inject, it } from "vitest";

import "./vitest-context";

const baseUrl = inject("e2eBaseUrl");

const validRequest = {
  tripId: "trip-e2e-123",
  recipientId: "recipient-e2e-456",
  eventType: "DRIVER_ASSIGNED",
  channels: ["PUSH"],
};

const expectedMessages = [
  ["TRIP_REQUESTED", "Tu solicitud de viaje fue recibida."],
  ["DRIVER_ASSIGNED", "Se asignó un conductor a tu viaje."],
  ["DRIVER_ARRIVED", "Tu conductor ha llegado al punto de encuentro."],
  ["TRIP_STARTED", "Tu viaje ha comenzado."],
  ["TRIP_CANCELLED", "Tu viaje fue cancelado."],
  ["TRIP_COMPLETED", "Tu viaje ha finalizado."],
] as const;

async function postNotification(body: unknown, contentType = "application/json") {
  return fetch(`${baseUrl}/notifications`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function getResource(path: string) {
  return fetch(`${baseUrl}${path}`);
}

async function expectSafeError(response: Response, code: string) {
  expect(response.headers.get("content-type")).toContain("application/json");
  const body = await response.json();
  expect(body.error.code).toBe(code);
  const serialized = JSON.stringify(body).toLowerCase();
  expect(serialized).not.toContain("stack");
  expect(serialized).not.toContain("/app/");
  expect(serialized).not.toContain("container");
}

describe("POST /notifications E2E", () => {
  it("processes a valid notification through the public HTTP contract", async () => {
    const response = await postNotification(validRequest);

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(
      ["notificationId", "tripId", "recipientId", "eventType", "channels", "message", "status", "createdAt"].sort(),
    );
    expect(body).toMatchObject({
      tripId: validRequest.tripId,
      recipientId: validRequest.recipientId,
      eventType: validRequest.eventType,
      channels: validRequest.channels,
      message: "Se asignó un conductor a tu viaje.",
      status: "PROCESSED",
    });
    expect(body.notificationId).toEqual(expect.any(String));
    expect(body.notificationId.length).toBeGreaterThan(0);
    expect(body.createdAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false);
  });

  it.each(expectedMessages)("processes %s with its message", async (eventType, message) => {
    const response = await postNotification({ ...validRequest, eventType });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ eventType, message, status: "PROCESSED" });
  });

  it("accepts application/json with a charset", async () => {
    const response = await postNotification(validRequest, "application/json; charset=utf-8");

    expect(response.status).toBe(201);
    expect((await response.json()).status).toBe("PROCESSED");
  });

  it.each([
    ["tripId is missing", { recipientId: "recipient", eventType: "TRIP_STARTED", channels: ["PUSH"] }],
    ["recipientId is missing", { tripId: "trip", eventType: "TRIP_STARTED", channels: ["PUSH"] }],
    ["eventType is invalid", { ...validRequest, eventType: "UNKNOWN" }],
    ["channels is empty", { ...validRequest, channels: [] }],
    ["EMAIL is requested", { ...validRequest, channels: ["EMAIL"] }],
    ["an additional property is included", { ...validRequest, additional: true }],
  ])("returns a safe 400 VALIDATION_ERROR when %s", async (_description, body) => {
    const response = await postNotification(body);

    expect(response.status).toBe(400);
    await expectSafeError(response, "VALIDATION_ERROR");
  });

  it("returns a safe 400 VALIDATION_ERROR for malformed JSON", async () => {
    const response = await postNotification('{"tripId":');

    expect(response.status).toBe(400);
    await expectSafeError(response, "VALIDATION_ERROR");
  });

  it.each([
    ["text/plain", "text/plain"],
    ["application/xml", "application/xml"],
  ])("returns a safe 415 UNSUPPORTED_MEDIA_TYPE for %s", async (_description, contentType) => {
    const response = await postNotification("not JSON", contentType);

    expect(response.status).toBe(415);
    await expectSafeError(response, "UNSUPPORTED_MEDIA_TYPE");
  });
});

describe("recursos públicos E2E", () => {
  it("serves the integrated RF-8.1 and RF-8.2 demonstration UI from Docker", async () => {
    const response = await getResource("/");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("M8 - Notificaciones");
    expect(body).toContain("RF-8.2 — Verificación QR");
    expect(body).toContain("qr-generation-form");
    expect(body).toContain("validate-qr-button");
    expect(body).toContain("/styles.css");
    expect(body).toContain("/app.js");
    expect(body).toContain("/openapi.yaml");
  });

  it("serves the UI stylesheet from Docker", async () => {
    const response = await getResource("/styles.css");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
    expect((await response.text()).length).toBeGreaterThan(0);
  });

  it("serves the UI script from Docker", async () => {
    const response = await getResource("/app.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    const body = await response.text();
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain("/notifications");
    expect(body).toContain("/qr");
    expect(body).toContain("/qr/validate");
  });

  it("serves the approved OpenAPI contract from Docker", async () => {
    const response = await getResource("/openapi.yaml");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("yaml");
    const body = await response.text();
    expect(body).toContain("openapi: 3.0.3");
    expect(body).toContain("/notifications");
    expect(body).toContain("post:");
  });
});

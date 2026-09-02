/*
 * RF-8.1 — Pruebas E2E API contra el servicio M8 en Docker.
 * Verifican contrato HTTP público y recursos estáticos mediante HTTP real.
 */
import { describe, expect, inject, it } from "vitest";

import "../infrastructure/vitest-context";

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

describe("RF-8.1 — POST /notifications E2E", () => {
  it("procesa una notificación válida mediante el contrato HTTP público", async () => {
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

  it.each(expectedMessages)("procesa %s con su mensaje", async (eventType, message) => {
    const response = await postNotification({ ...validRequest, eventType });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ eventType, message, status: "PROCESSED" });
  });

  it("acepta application/json con charset", async () => {
    const response = await postNotification(validRequest, "application/json; charset=utf-8");

    expect(response.status).toBe(201);
    expect((await response.json()).status).toBe("PROCESSED");
  });

  it.each([
    ["falta tripId", { recipientId: "recipient", eventType: "TRIP_STARTED", channels: ["PUSH"] }],
    ["falta recipientId", { tripId: "trip", eventType: "TRIP_STARTED", channels: ["PUSH"] }],
    ["eventType es inválido", { ...validRequest, eventType: "UNKNOWN" }],
    ["channels está vacío", { ...validRequest, channels: [] }],
    ["se solicita EMAIL", { ...validRequest, channels: ["EMAIL"] }],
    ["se incluye una propiedad adicional", { ...validRequest, additional: true }],
  ])("responde 400 VALIDATION_ERROR seguro cuando %s", async (_description, body) => {
    const response = await postNotification(body);

    expect(response.status).toBe(400);
    await expectSafeError(response, "VALIDATION_ERROR");
  });

  it("responde 400 VALIDATION_ERROR seguro ante JSON malformado", async () => {
    const response = await postNotification('{"tripId":');

    expect(response.status).toBe(400);
    await expectSafeError(response, "VALIDATION_ERROR");
  });

  it.each([
    ["text/plain", "text/plain"],
    ["application/xml", "application/xml"],
  ])("responde 415 UNSUPPORTED_MEDIA_TYPE seguro para %s", async (_description, contentType) => {
    const response = await postNotification("not JSON", contentType);

    expect(response.status).toBe(415);
    await expectSafeError(response, "UNSUPPORTED_MEDIA_TYPE");
  });
});

describe("recursos públicos E2E", () => {
  it("sirve desde Docker la interfaz de demostración integrada RF-8.1 y RF-8.2", async () => {
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

  it("sirve desde Docker la hoja de estilos de la interfaz", async () => {
    const response = await getResource("/styles.css");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
    expect((await response.text()).length).toBeGreaterThan(0);
  });

  it("sirve desde Docker el script de la interfaz", async () => {
    const response = await getResource("/app.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    const body = await response.text();
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain("/notifications");
    expect(body).toContain("/qr");
    expect(body).toContain("/qr/validate");
  });

  it("sirve desde Docker el contrato OpenAPI aprobado", async () => {
    const response = await getResource("/openapi.yaml");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("yaml");
    const body = await response.text();
    expect(body).toContain("openapi: 3.0.3");
    expect(body).toContain("/notifications");
    expect(body).toContain("post:");
  });
});

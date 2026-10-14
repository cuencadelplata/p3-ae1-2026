/*
 * RF-8.2 — Pruebas del contexto de solicitud (X-Correlation-Id) y del log de solicitudes.
 * Verifican el header válido, inválido y ausente, que el valor no llega al cuerpo y que
 * cada línea de log de la solicitud lleva el correlationId.
 */
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CORRELATION_HEADER, resolveCorrelationId } from "../../src/http/request-context";
import { createLogger } from "../../src/observability/logger";
import { buildApp } from "../helpers/build-app";
import { captureLogs, type CapturedLogs } from "../helpers/capture-logs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("resolveCorrelationId", () => {
  it.each(["abc-123", "trip_demo.001", "A".repeat(128)])("conserva el valor válido %s", (value) => {
    expect(resolveCorrelationId(value)).toBe(value);
  });

  it.each([
    ["ausente", undefined],
    ["vacío", ""],
    ["más de 128 caracteres", "A".repeat(129)],
    ["con salto de línea", "abc\ninyectado"],
    ["con espacios", "abc def"],
    ["con comillas y llaves", '{"level":"error"}'],
    ["con dos puntos", "abc:def"],
  ])("genera un UUID cuando el valor es %s", (_label, value) => {
    expect(resolveCorrelationId(value)).toMatch(UUID_PATTERN);
  });
});

describe("X-Correlation-Id vía HTTP", () => {
  let logs: CapturedLogs;

  beforeEach(() => {
    logs = captureLogs();
  });

  afterEach(() => {
    logs.restore();
  });

  it("devuelve el header recibido si es válido y lo usa en todos los logs de la solicitud", async () => {
    const app = buildApp({ log: createLogger("qr") });

    const response = await request(app)
      .post("/qr")
      .set(CORRELATION_HEADER, "corr-e2e-001")
      .send({ tripId: "trip-demo-001" });

    expect(response.status).toBe(201);
    expect(response.headers["x-correlation-id"]).toBe("corr-e2e-001");
    expect(response.body).not.toHaveProperty("correlationId");
    const entries = logs.entries();
    expect(entries.map((entry) => entry.message)).toEqual(["QR emitido", "solicitud atendida"]);
    for (const entry of entries) {
      expect(entry.correlationId).toBe("corr-e2e-001");
    }
  });

  it("reemplaza un header inválido por un UUID nuevo", async () => {
    const response = await request(buildApp())
      .post("/qr")
      .set(CORRELATION_HEADER, "valor con espacios")
      .send({ tripId: "trip-demo-001" });

    expect(response.headers["x-correlation-id"]).toMatch(UUID_PATTERN);
  });

  it("genera un UUID cuando no viene el header, también en respuestas de error", async () => {
    const response = await request(buildApp()).post("/qr").send({});

    expect(response.status).toBe(400);
    expect(response.headers["x-correlation-id"]).toMatch(UUID_PATTERN);
    expect(Object.keys(response.body)).toEqual(["error"]);
  });

  it("registra cada solicitud con método, ruta sin query, estado y duración", async () => {
    await request(buildApp()).post("/qr/validate?debug=1").send({ tripId: "trip-1", token: "no-existe" });

    expect(logs.entries()).toEqual([
      expect.objectContaining({
        level: "info",
        component: "http",
        message: "solicitud atendida",
        method: "POST",
        path: "/qr/validate",
        status: 404,
        durationMs: expect.any(Number),
        correlationId: expect.stringMatching(UUID_PATTERN),
      }),
    ]);
  });

  it("no registra las consultas de salud", async () => {
    const app = buildApp();

    await request(app).get("/health/live");
    await request(app).get("/health/ready");
    await request(app).get("/health");

    expect(logs.lines).toEqual([]);
  });
});

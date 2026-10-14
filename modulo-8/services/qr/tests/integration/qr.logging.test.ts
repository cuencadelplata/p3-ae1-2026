/*
 * RF-8.2 — Pruebas de los eventos de log del QR.
 * Recorren generar, validar, reusar, vencido, otro viaje y no encontrado, y verifican los
 * eventos, el motivo interno de cada rechazo y que ninguna línea contenga el token en claro.
 */
import { createHash } from "node:crypto";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app";
import { createLogger } from "../../src/observability/logger";
import { loggableTripId, type QrService } from "../../src/qr.service";
import { buildApp } from "../helpers/build-app";
import { captureLogs, type CapturedLogs } from "../helpers/capture-logs";

const TRIP_ID = "trip-demo-001";
const TTL_MS = 300_000;

describe("eventos de log del QR", () => {
  let logs: CapturedLogs;

  beforeEach(() => {
    logs = captureLogs();
  });

  afterEach(() => {
    logs.restore();
  });

  it("registra cada resultado con su evento y motivo, y nunca el token en claro", async () => {
    let now = new Date("2026-09-01T12:00:00.000Z");
    const app = buildApp({ log: createLogger("qr"), now: () => now });
    const generate = async (tripId: string) => (await request(app).post("/qr").send({ tripId })).body.token as string;
    const validate = (tripId: string, token: string) => request(app).post("/qr/validate").send({ tripId, token });
    const usedTripId = `${TRIP_ID}-used`;
    const expiringTripId = `${TRIP_ID}-expires`;
    const otherTripOwnerId = `${TRIP_ID}-owner`;

    const usedToken = await generate(usedTripId);
    const expiringToken = await generate(expiringTripId);
    const otherTripToken = await generate(otherTripOwnerId);
    const unknownToken = "token-que-nunca-se-emitio";

    expect((await validate(usedTripId, usedToken)).status).toBe(200);
    expect((await validate(usedTripId, usedToken)).status).toBe(409);
    expect((await validate("otro-viaje", otherTripToken)).status).toBe(404);
    expect((await validate(TRIP_ID, unknownToken)).status).toBe(404);
    now = new Date(now.getTime() + TTL_MS);
    expect((await validate(expiringTripId, expiringToken)).status).toBe(410);

    const tokens = [usedToken, expiringToken, otherTripToken, unknownToken];
    for (const line of logs.lines) {
      for (const token of tokens) {
        expect(line).not.toContain(token);
      }
    }

    const prefix = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 8);
    const qrEvents = logs
      .entries()
      .filter((entry) => entry.component === "qr")
      .map(({ level, event, tripId, tokenHashPrefix, reason }) => ({ level, event, tripId, tokenHashPrefix, reason }));

    expect(qrEvents).toEqual([
      { level: "info", event: "qr.issued", tripId: usedTripId, tokenHashPrefix: prefix(usedToken), reason: undefined },
      { level: "info", event: "qr.issued", tripId: expiringTripId, tokenHashPrefix: prefix(expiringToken), reason: undefined },
      { level: "info", event: "qr.issued", tripId: otherTripOwnerId, tokenHashPrefix: prefix(otherTripToken), reason: undefined },
      { level: "info", event: "qr.validated", tripId: usedTripId, tokenHashPrefix: prefix(usedToken), reason: undefined },
      { level: "info", event: "qr.rejected", tripId: usedTripId, tokenHashPrefix: prefix(usedToken), reason: "ALREADY_USED" },
      {
        level: "warn",
        event: "qr.rejected",
        tripId: "otro-viaje",
        tokenHashPrefix: prefix(otherTripToken),
        reason: "TRIP_MISMATCH",
      },
      { level: "info", event: "qr.rejected", tripId: TRIP_ID, tokenHashPrefix: prefix(unknownToken), reason: "NOT_FOUND" },
      { level: "info", event: "qr.rejected", tripId: expiringTripId, tokenHashPrefix: prefix(expiringToken), reason: "EXPIRED" },
    ]);
    for (const entry of logs.entries().filter((candidate) => candidate.event === "qr.issued")) {
      expect(entry.expiresAt).toEqual(expect.any(String));
    }
  });

  it("no registra el cuerpo de la solicitud", async () => {
    const app = buildApp({ log: createLogger("qr") });
    const token = (await request(app).post("/qr").send({ tripId: TRIP_ID })).body.token as string;

    await request(app).post("/qr/validate").send({ tripId: TRIP_ID, token, extra: "campo-no-permitido" });

    expect(logs.lines.join("\n")).not.toContain("campo-no-permitido");
    expect(logs.lines.join("\n")).not.toContain(token);
  });
});

describe("tripId en los logs", () => {
  let logs: CapturedLogs;

  beforeEach(() => {
    logs = captureLogs();
  });

  afterEach(() => {
    logs.restore();
  });

  it("recorta a 64 caracteres más '…' un tripId de 10 000 caracteres, sin cambiar las respuestas", async () => {
    const longTripId = "t".repeat(10_000);
    const app = buildApp({ log: createLogger("qr") });

    const generated = await request(app).post("/qr").send({ tripId: longTripId });
    const validated = await request(app).post("/qr/validate").send({ tripId: longTripId, token: generated.body.token });
    const reused = await request(app).post("/qr/validate").send({ tripId: longTripId, token: generated.body.token });

    expect(generated.status).toBe(201);
    expect(validated.status).toBe(200);
    expect(validated.body).toEqual({ valid: true });
    expect(reused.status).toBe(409);

    const qrEntries = logs.entries().filter((entry) => entry.component === "qr");
    expect(qrEntries.map((entry) => entry.event)).toEqual(["qr.issued", "qr.validated", "qr.rejected"]);
    for (const entry of qrEntries) {
      expect(entry.tripId).toBe(`${"t".repeat(64)}…`);
    }
    for (const line of logs.lines) {
      expect(line.length).toBeLessThan(1000);
    }
  });

  it("no recorta un tripId de 64 caracteres o menos", () => {
    expect(loggableTripId("t".repeat(64))).toBe("t".repeat(64));
    expect(loggableTripId("trip-demo-001")).toBe("trip-demo-001");
  });
});

describe("errores inesperados", () => {
  let logs: CapturedLogs;

  beforeEach(() => {
    logs = captureLogs();
  });

  afterEach(() => {
    logs.restore();
  });

  it("un error inesperado responde 500 con el formato de siempre y queda registrado con su pila", async () => {
    const failingService: QrService = {
      generateQr: async () => {
        throw new TypeError("fallo interno con detalle");
      },
      validateQr: async () => ({ valid: true }),
    };
    const app = createApp({ qrService: failingService, checkRedis: async () => true });

    const response = await request(app).post("/qr").send({ tripId: TRIP_ID });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: "INTERNAL_SERVER_ERROR", message: "No fue posible procesar la solicitud." },
    });
    expect(JSON.stringify(response.body)).not.toContain("fallo interno");

    const errorEntry = logs.entries().find((entry) => entry.message === "error inesperado al atender la solicitud");
    expect(errorEntry).toEqual(
      expect.objectContaining({
        level: "error",
        component: "http",
        method: "POST",
        errorName: "TypeError",
        reason: "fallo interno con detalle",
        stack: expect.stringContaining("TypeError"),
        correlationId: response.headers["x-correlation-id"],
      }),
    );
  });
});

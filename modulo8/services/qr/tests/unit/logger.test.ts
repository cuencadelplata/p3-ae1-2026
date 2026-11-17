/*
 * RF-8.2 — Pruebas unitarias del logger estructurado.
 * Verifican el formato JSON por línea y el correlationId tomado del contexto.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLogger, currentCorrelationId, errorFields, withCorrelationId } from "../../src/observability/logger";
import { captureLogs, type CapturedLogs } from "../helpers/capture-logs";

describe("createLogger", () => {
  let logs: CapturedLogs;

  beforeEach(() => {
    logs = captureLogs();
  });

  afterEach(() => {
    logs.restore();
  });

  it("escribe una línea JSON con timestamp, level, service, component, message y los campos", () => {
    createLogger("qr")("info", "QR emitido", { event: "qr.issued", tripId: "trip-1" });

    expect(logs.lines).toHaveLength(1);
    expect(logs.lines[0]).not.toContain("\n");
    const [entry] = logs.entries();
    expect(entry).toEqual({
      timestamp: expect.any(String),
      level: "info",
      service: "qr",
      component: "qr",
      message: "QR emitido",
      event: "qr.issued",
      tripId: "trip-1",
    });
    expect(new Date(entry.timestamp as string).toISOString()).toBe(entry.timestamp);
  });

  it.each(["info", "warn", "error"] as const)("escribe el nivel %s en la consola del mismo nivel", (level) => {
    createLogger("qr")(level, "mensaje");

    expect(logs.entries()[0].level).toBe(level);
  });

  it("sin contexto no incluye correlationId", () => {
    createLogger("qr")("info", "sin contexto");

    expect(currentCorrelationId()).toBeUndefined();
    expect(logs.entries()[0]).not.toHaveProperty("correlationId");
  });

  it("toma el correlationId del contexto, también después de un await", async () => {
    const log = createLogger("qr");

    await withCorrelationId("corr-123", async () => {
      log("info", "antes");
      await new Promise((resolve) => setTimeout(resolve, 1));
      log("info", "después");
    });
    log("info", "fuera del contexto");

    expect(logs.entries().map((entry) => entry.correlationId)).toEqual(["corr-123", "corr-123", undefined]);
  });

  it("los campos adicionales no reemplazan los campos fijos", () => {
    withCorrelationId("corr-real", () =>
      createLogger("qr")("info", "mensaje real", {
        level: "error",
        message: "falso",
        service: "otro",
        component: "otro",
        correlationId: "falso",
        timestamp: "falso",
      }),
    );

    expect(logs.entries()[0]).toEqual({
      timestamp: expect.not.stringMatching("falso"),
      level: "info",
      service: "qr",
      component: "qr",
      message: "mensaje real",
      correlationId: "corr-real",
    });
  });
});

describe("errorFields", () => {
  it("incluye nombre, mensaje y pila de un Error", () => {
    const error = new TypeError("fallo");

    expect(errorFields(error)).toEqual({ errorName: "TypeError", reason: "fallo", stack: error.stack });
  });

  it("usa el code cuando el error no trae mensaje", () => {
    const error = Object.assign(new Error(""), { code: "ECONNREFUSED" });

    expect(errorFields(error).reason).toBe("ECONNREFUSED");
  });

  it("convierte a texto un valor que no es Error", () => {
    expect(errorFields("algo")).toEqual({ reason: "algo" });
  });
});

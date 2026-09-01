import { afterEach, describe, expect, it, vi } from "vitest";

import { loadQrConfig } from "../../../src/qr/qr.config";

describe("loadQrConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("usa 300 como TTL por defecto cuando QR_TTL_SECONDS no está definida", () => {
    expect(loadQrConfig({})).toEqual({ ttlSeconds: 300 });
  });

  it("acepta un TTL entero positivo válido", () => {
    expect(loadQrConfig({ QR_TTL_SECONDS: "120" })).toEqual({ ttlSeconds: 120 });
  });

  it("acepta un TTL de un solo dígito", () => {
    expect(loadQrConfig({ QR_TTL_SECONDS: "1" })).toEqual({ ttlSeconds: 1 });
  });

  it.each([
    ["cero", "0"],
    ["negativo", "-1"],
    ["decimal", "300.5"],
    ["texto no numérico", "abc"],
    ["cadena vacía", ""],
    ["solo espacios", "   "],
    ["notación exponencial", "3e2"],
    ["fuera del rango entero seguro", "99999999999999999999"],
  ])("rechaza QR_TTL_SECONDS=%s (%s)", (_label, raw) => {
    expect(() => loadQrConfig({ QR_TTL_SECONDS: raw })).toThrow(/QR_TTL_SECONDS/);
  });

  it("usa process.env como fuente por defecto cuando no se pasa un env explícito", () => {
    vi.stubEnv("QR_TTL_SECONDS", "180");

    expect(loadQrConfig()).toEqual({ ttlSeconds: 180 });
  });
});

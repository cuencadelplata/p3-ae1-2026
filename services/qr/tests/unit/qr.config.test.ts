/*
 * RF-8.2 — Pruebas unitarias de la configuración del servicio QR.
 * Verifican QR_TTL_SECONDS, QR_EXPIRED_GRACE_SECONDS y REDIS_URL sin iniciar el servicio.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadQrConfig } from "../../src/qr.config";

const DEFAULTS = { ttlSeconds: 300, expiredGraceSeconds: 3600, redisUrl: undefined };

const INVALID_POSITIVE_INTEGERS = [
  ["cero", "0"],
  ["negativo", "-1"],
  ["decimal", "300.5"],
  ["texto no numérico", "abc"],
  ["cadena vacía", ""],
  ["solo espacios", "   "],
  ["notación exponencial", "3e2"],
  ["fuera del rango entero seguro", "99999999999999999999"],
] as const;

describe("loadQrConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("usa 300 como TTL por defecto cuando QR_TTL_SECONDS no está definida", () => {
    expect(loadQrConfig({})).toEqual(DEFAULTS);
  });

  it("acepta un TTL entero positivo válido", () => {
    expect(loadQrConfig({ QR_TTL_SECONDS: "120" })).toEqual({ ...DEFAULTS, ttlSeconds: 120 });
  });

  it("acepta un TTL de un solo dígito", () => {
    expect(loadQrConfig({ QR_TTL_SECONDS: "1" })).toEqual({ ...DEFAULTS, ttlSeconds: 1 });
  });

  it.each(INVALID_POSITIVE_INTEGERS)("rechaza QR_TTL_SECONDS=%s (%s)", (_label, raw) => {
    expect(() => loadQrConfig({ QR_TTL_SECONDS: raw })).toThrow(/QR_TTL_SECONDS/);
  });

  it("usa process.env como fuente por defecto cuando no se pasa un env explícito", () => {
    vi.stubEnv("QR_TTL_SECONDS", "180");
    vi.stubEnv("QR_EXPIRED_GRACE_SECONDS", "60");
    vi.stubEnv("REDIS_URL", "redis://redis:6379");

    expect(loadQrConfig()).toEqual({
      ttlSeconds: 180,
      expiredGraceSeconds: 60,
      redisUrl: "redis://redis:6379",
    });
  });
});

describe("loadQrConfig — QR_EXPIRED_GRACE_SECONDS", () => {
  it("acepta un margen entero positivo válido", () => {
    expect(loadQrConfig({ QR_EXPIRED_GRACE_SECONDS: "60" })).toEqual({ ...DEFAULTS, expiredGraceSeconds: 60 });
  });

  it.each(INVALID_POSITIVE_INTEGERS)("rechaza QR_EXPIRED_GRACE_SECONDS=%s (%s)", (_label, raw) => {
    expect(() => loadQrConfig({ QR_EXPIRED_GRACE_SECONDS: raw })).toThrow(/QR_EXPIRED_GRACE_SECONDS/);
  });
});

describe("loadQrConfig — REDIS_URL", () => {
  it.each(["redis://localhost:6379", "redis://redis:6379/0", "rediss://usuario:clave@redis.example:6380"])(
    "acepta %s",
    (raw) => {
      expect(loadQrConfig({ REDIS_URL: raw })).toEqual({ ...DEFAULTS, redisUrl: raw });
    },
  );

  it.each([
    ["cadena vacía", ""],
    ["sin protocolo", "localhost:6379"],
    ["protocolo http", "http://localhost:6379"],
    ["texto no URL", "no es una url"],
  ])("rechaza REDIS_URL %s", (_label, raw) => {
    expect(() => loadQrConfig({ REDIS_URL: raw })).toThrow(/REDIS_URL/);
  });

  it("el error de una REDIS_URL inválida no repite el valor recibido (puede contener credenciales)", () => {
    const raw = "http://usuario:clave-secreta@localhost:6379";

    expect(() => loadQrConfig({ REDIS_URL: raw })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("clave-secreta") }),
    );
  });
});

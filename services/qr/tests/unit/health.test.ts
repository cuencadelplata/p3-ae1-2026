/*
 * RF-8.2 — Pruebas unitarias de la comprobación con tope de tiempo del health.
 * Verifican disponible, no disponible, rechazo y vencimiento del tope con reloj simulado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HEALTH_CHECK_TIMEOUT_MS, probeWithTimeout } from "../../src/health";

describe("probeWithTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("devuelve true cuando la comprobación responde disponible", async () => {
    await expect(probeWithTimeout(async () => true, HEALTH_CHECK_TIMEOUT_MS)).resolves.toBe(true);
  });

  it("devuelve false cuando la comprobación responde no disponible", async () => {
    await expect(probeWithTimeout(async () => false, HEALTH_CHECK_TIMEOUT_MS)).resolves.toBe(false);
  });

  it("devuelve false cuando la comprobación rechaza", async () => {
    const check = async (): Promise<boolean> => {
      throw new Error("ECONNREFUSED");
    };

    await expect(probeWithTimeout(check, HEALTH_CHECK_TIMEOUT_MS)).resolves.toBe(false);
  });

  it("una comprobación que no responde cuenta como no disponible al vencer el tope de 2 s", async () => {
    let settled = false;
    const result = probeWithTimeout(() => new Promise<boolean>(() => {}), HEALTH_CHECK_TIMEOUT_MS).then((value) => {
      settled = true;
      return value;
    });

    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(false);
  });

  it("una respuesta disponible que llega antes del tope gana", async () => {
    const result = probeWithTimeout(
      () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), HEALTH_CHECK_TIMEOUT_MS - 1)),
      HEALTH_CHECK_TIMEOUT_MS,
    );

    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS - 1);
    await expect(result).resolves.toBe(true);
  });
});

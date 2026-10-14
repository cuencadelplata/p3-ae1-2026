/*
 * RF-8.2 — Pruebas unitarias del cierre ordenado del servicio QR.
 * Verifican orden, tope de espera, idempotencia ante señales repetidas y código de salida
 * sin levantar un proceso.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGracefulShutdown, type GracefulShutdownDeps } from "../../src/shutdown";

const TIMEOUT_MS = 10_000;

// Servidor falso: el callback de close() queda pendiente hasta que terminan las solicitudes
// en curso (finishInFlight) o se cortan las conexiones (closeAllConnections), como en un
// servidor HTTP real.
function createDeps(overrides: Partial<GracefulShutdownDeps> = {}) {
  const calls: string[] = [];
  let onClosed: (() => void) | undefined;

  const server = {
    close: vi.fn((callback?: (error?: Error) => void) => {
      calls.push("server.close");
      onClosed = () => callback?.();
      return server;
    }),
    closeAllConnections: vi.fn(() => {
      calls.push("server.closeAllConnections");
      onClosed?.();
    }),
  };

  const deps = {
    server: server as unknown as GracefulShutdownDeps["server"],
    timeoutMs: TIMEOUT_MS,
    log: vi.fn(),
    exit: vi.fn((code: number) => {
      calls.push(`exit(${code})`);
    }),
    closeResources: vi.fn(async () => {
      calls.push("closeResources");
    }),
    ...overrides,
  };

  return { deps, server, calls, finishInFlight: () => onClosed?.() };
}

describe("createGracefulShutdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cierra el HTTP, espera las solicitudes en curso, cierra los recursos y sale con 0", async () => {
    const { deps, calls, finishInFlight } = createDeps();
    const shutdown = createGracefulShutdown(deps);

    const done = shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual(["server.close"]);
    expect(deps.closeResources).not.toHaveBeenCalled();

    finishInFlight();
    await done;

    expect(calls).toEqual(["server.close", "closeResources", "exit(0)"]);
  });

  it("una segunda señal durante el cierre no lo repite", async () => {
    const { deps, server, finishInFlight } = createDeps();
    const shutdown = createGracefulShutdown(deps);

    const first = shutdown("SIGTERM");
    const second = shutdown("SIGINT");
    expect(second).toBe(first);

    finishInFlight();
    await first;
    await shutdown("SIGTERM");

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(deps.closeResources).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it("al vencer el tope corta las conexiones en curso y continúa el cierre", async () => {
    const { deps, calls } = createDeps();
    const shutdown = createGracefulShutdown(deps);

    const done = shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(calls).toEqual(["server.close"]);

    await vi.advanceTimersByTimeAsync(1);
    await done;

    expect(calls).toEqual(["server.close", "server.closeAllConnections", "closeResources", "exit(0)"]);
    expect(deps.log).toHaveBeenCalledWith("warn", expect.any(String), { timeoutMs: TIMEOUT_MS });
  });

  it("si cerrar los recursos falla, lo informa y sale con 1", async () => {
    const { deps, finishInFlight } = createDeps({
      closeResources: vi.fn(async () => {
        throw new Error("redis no cerró");
      }),
    });
    const shutdown = createGracefulShutdown(deps);

    const done = shutdown("SIGTERM");
    finishInFlight();
    await done;

    expect(deps.log).toHaveBeenCalledWith("error", expect.any(String), { reason: "redis no cerró" });
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(1);
  });
});

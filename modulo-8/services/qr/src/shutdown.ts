import type { Server } from "node:http";

export type ShutdownLog = (
  level: "info" | "warn" | "error",
  message: string,
  fields?: Record<string, unknown>,
) => void;

export interface GracefulShutdownDeps {
  readonly server: Pick<Server, "close" | "closeAllConnections">;
  // Libera los recursos externos (por ejemplo, el cliente Redis) una vez cerrado el HTTP.
  readonly closeResources: () => Promise<void>;
  // Tope de espera para las solicitudes en curso; al vencer se cortan las conexiones.
  readonly timeoutMs: number;
  readonly log: ShutdownLog;
  readonly exit: (code: number) => void;
}

// Devuelve la función que atiende una señal de cierre. El cierre corre una sola vez: una
// segunda señal mientras está en curso recibe la misma promesa y no lo repite.
//
// Orden: dejar de aceptar conexiones y esperar las solicitudes en curso (con tope), cerrar
// los recursos y terminar el proceso.
export function createGracefulShutdown(deps: GracefulShutdownDeps): (signal: string) => Promise<void> {
  let shutdown: Promise<void> | undefined;

  function closeServer(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        deps.log("warn", "solicitudes en curso sin terminar al vencer el tope, se cortan las conexiones", {
          timeoutMs: deps.timeoutMs,
        });
        deps.server.closeAllConnections();
      }, deps.timeoutMs);
      timer.unref();

      deps.server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async function run(signal: string): Promise<void> {
    deps.log("info", "cierre ordenado iniciado", { signal });
    await closeServer();

    try {
      await deps.closeResources();
    } catch (error) {
      deps.log("error", "no fue posible cerrar los recursos", {
        reason: error instanceof Error ? error.message : String(error),
      });
      deps.exit(1);
      return;
    }

    deps.log("info", "cierre ordenado completo");
    deps.exit(0);
  }

  return (signal) => {
    shutdown ??= run(signal);
    return shutdown;
  };
}

import { createApp } from "./app";
import { generateQrDataUrl, generateQrToken } from "./qr-generator";
import { loadQrConfig, type QrConfig } from "./qr.config";
import { createRedisQrStore } from "./qr.redis-store";
import { createQrService } from "./qr.service";
import { createQrRedisClient, isRedisReady } from "./redis-client";
import { createGracefulShutdown, type ShutdownLog } from "./shutdown";

// Punto de arranque del servicio QR: arma las dependencias, atiende HTTP y cierra en orden.
//
// El servicio exige REDIS_URL. No hay respaldo en memoria: un estado por proceso rompería
// el uso único entre instancias, por eso el store en memoria queda sólo para las pruebas.
//
// El servidor HTTP arranca sin esperar a Redis. Mientras Redis no esté disponible, los
// comandos fallan en el momento (disableOfflineQueue) y el cliente se reconecta solo.

const defaultPort = 3000;
const configuredPort = Number(process.env.PORT);
const port =
  Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535
    ? configuredPort
    : defaultPort;

// Menor que los 10 s que Docker espera tras SIGTERM antes de enviar SIGKILL, para que el
// cierre de Redis ocurra aunque haya solicitudes que no terminan.
const SHUTDOWN_TIMEOUT_MS = 8_000;

const log: ShutdownLog = (level, message, fields = {}) => {
  console[level](JSON.stringify({ level, component: "server", message, ...fields }));
};

function loadConfigOrExit(): QrConfig & { readonly redisUrl: string } {
  let config: QrConfig;
  try {
    config = loadQrConfig();
  } catch (error) {
    log("error", "configuración inválida", { reason: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }

  if (config.redisUrl === undefined) {
    log("error", "configuración inválida", {
      reason: "REDIS_URL es obligatoria: el servicio QR guarda los QR en Redis.",
    });
    process.exit(1);
  }

  return { ...config, redisUrl: config.redisUrl };
}

const config = loadConfigOrExit();

const redisClient = createQrRedisClient({ url: config.redisUrl });

const qrService = createQrService({
  store: createRedisQrStore({ client: redisClient, expiredGraceSeconds: config.expiredGraceSeconds }),
  config,
  generateQrToken,
  generateQrDataUrl,
  now: () => new Date(),
});

const server = createApp({ qrService, checkRedis: () => isRedisReady(redisClient) }).listen(port, () => {
  log("info", "servicio QR escuchando", { port });
});

server.on("error", (error) => {
  log("error", "no fue posible iniciar el servidor HTTP", { reason: error.message });
  process.exit(1);
});

// Sin await: el HTTP no espera a Redis. La promesa sólo se rechaza si el cliente se cierra
// mientras conecta; los intentos fallidos los informa el propio cliente.
redisClient.connect().catch((error: unknown) => {
  log("warn", "se abandonó la conexión inicial con Redis", {
    reason: error instanceof Error ? error.message : String(error),
  });
});

const shutdown = createGracefulShutdown({
  server,
  timeoutMs: SHUTDOWN_TIMEOUT_MS,
  log,
  exit: (code) => process.exit(code),
  closeResources: async () => {
    if (redisClient.isReady) {
      await redisClient.close();
    } else if (redisClient.isOpen) {
      // Conectando o reconectando: no hay comandos pendientes que esperar.
      redisClient.destroy();
    }
  },
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

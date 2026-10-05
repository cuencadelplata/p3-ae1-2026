import { createClient } from "redis";

import { createLogger, type Logger } from "./observability/logger";
import { qrRedisScripts } from "./qr.redis-scripts";

export interface QrRedisClientOptions {
  readonly url: string;
  readonly connectTimeoutMs?: number;
  // Tiempo máximo de cada comando. Al vencer, la promesa se rechaza, pero si el comando ya
  // se había enviado Redis puede ejecutarlo igual: el resultado queda indeterminado.
  readonly commandTimeoutMs?: number;
  readonly log?: Logger;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 2000;
const DEFAULT_COMMAND_TIMEOUT_MS = 2000;
const RECONNECT_STEP_MS = 200;
const RECONNECT_MAX_DELAY_MS = 5000;

// Crea el cliente sin conectarlo: quien lo use decide cuándo llamar a connect() y close().
//
// Con disableOfflineQueue, un comando sin conexión falla en el momento en lugar de esperar
// la reconexión. Mientras tanto el cliente se reconecta solo, con espera creciente acotada.
export function createQrRedisClient(options: QrRedisClientOptions) {
  const log = options.log ?? createLogger("redis");

  const client = createClient({
    url: options.url,
    disableOfflineQueue: true,
    commandOptions: { timeout: options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS },
    socket: {
      connectTimeout: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries) => Math.min(RECONNECT_STEP_MS * (retries + 1), RECONNECT_MAX_DELAY_MS),
    },
    scripts: qrRedisScripts,
  });

  // El cliente emite un error por cada intento fallido: se informa sólo el primero hasta que
  // vuelve a estar listo. El mensaje no incluye la URL, que puede contener credenciales.
  let disconnected = false;
  client.on("error", (error: Error & { code?: string }) => {
    if (!disconnected) {
      disconnected = true;
      // Un rechazo de conexión puede llegar como AggregateError sin mensaje, sólo con code.
      log("error", "sin conexión con Redis, reintentando", { reason: error.message || error.code || error.name });
    }
  });
  client.on("ready", () => {
    disconnected = false;
    log("info", "conectado a Redis");
  });

  return client;
}

export type QrRedisClient = ReturnType<typeof createQrRedisClient>;

// Disponibilidad de Redis para el health: conexión lista y respuesta a PING. Sin conexión
// responde false sin enviar el comando.
export async function isRedisReady(client: QrRedisClient): Promise<boolean> {
  return client.isReady && (await client.ping()) === "PONG";
}

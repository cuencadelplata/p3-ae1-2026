/*
 * Store de QR INCORRECTO, sólo para pruebas. Sirve para demostrar la carrera que resuelve
 * el store real: consume "leyendo y después escribiendo" en dos comandos separados, de modo
 * que entre la lectura y la escritura se pueden intercalar otras validaciones del mismo QR.
 * No debe usarse fuera de las pruebas.
 */
import { createRedisQrStore } from "../../src/qr.redis-store";
import type { ConsumeOutcome, QrGetOrCreateResult, QrOperationalRecord, QrStore } from "../../src/qr.store";
import type { QrRedisClient } from "../../src/redis-client";

export interface NaiveRedisQrStoreOptions {
  readonly client: QrRedisClient;
  readonly keyPrefix: string;
  // Se espera entre la lectura y la escritura. En las pruebas es una barrera que obliga a que
  // todas las lecturas ocurran antes de la primera escritura.
  readonly betweenReadAndWrite: () => Promise<void>;
}

export function createNaiveRedisQrStore(options: NaiveRedisQrStoreOptions): QrStore {
  const { client, keyPrefix } = options;
  // El guardado no participa de la carrera: se reutiliza el del store real.
  const saver = createRedisQrStore({ client, keyPrefix, expiredGraceSeconds: 3600 });

  async function getOrCreateActive(record: QrOperationalRecord, now: Date): Promise<QrGetOrCreateResult> {
    return saver.getOrCreateActive(record, now);
  }

  async function consumeIfValid(tokenHash: string, tripId: string, now: Date): Promise<ConsumeOutcome> {
    const key = `${keyPrefix}${tokenHash}`;

    // 1) Leer.
    const [storedTripId, expiresAt, usedAt] = await client.hmGet(key, ["tripId", "expiresAt", "usedAt"]);
    if (storedTripId === null) {
      return "NOT_FOUND";
    }
    if (storedTripId !== tripId) {
      return "TRIP_MISMATCH";
    }
    if (usedAt !== null) {
      return "ALREADY_USED";
    }
    if (now.getTime() >= Number(expiresAt)) {
      return "EXPIRED";
    }

    // 2) Decidir con un dato que ya puede estar desactualizado...
    await options.betweenReadAndWrite();

    // 3) ...y escribir sin volver a comprobar.
    await client.hSet(key, "usedAt", String(now.getTime()));
    return "OK";
  }

  return { save: saver.save, getOrCreateActive, consumeIfValid };
}

// Barrera para `parties` participantes: cada llamada espera hasta que hayan llegado todos y
// recién entonces se liberan juntos. Si no llegan todos antes del tope, rechaza para que la
// prueba falle en vez de quedar colgada.
export function createBarrier(parties: number, timeoutMs = 5000): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const allArrived = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrived += 1;
    if (arrived === parties) {
      release();
    }

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`La barrera esperaba ${parties} participantes y llegaron ${arrived}.`)),
        timeoutMs,
      );
    });

    try {
      await Promise.race([allArrived, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}

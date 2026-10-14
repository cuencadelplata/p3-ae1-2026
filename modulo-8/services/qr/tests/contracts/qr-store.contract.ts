/*
 * RF-8.2 — Contrato de comportamiento de QrStore.
 * Cualquier implementación (en memoria, Redis) debe cumplir estas pruebas: asociación,
 * vencimiento y consumo único, sin usar HTTP.
 *
 * Las fechas se calculan con el reloj que decide el vencimiento en cada implementación (el
 * del proceso para el store en memoria, el de Redis para el store en Redis) y cada prueba usa
 * un tokenHash propio, para que el mismo contrato pueda correr contra un almacenamiento
 * compartido. Con relojes distintos, el caso del borde exacto dependería del desfase entre
 * ambos.
 */
import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { QrOperationalRecord, QrStore } from "../../src/qr.store";
import type { QrRecord } from "../../src/qr.types";

const TRIP_ID = "trip-demo-001";
const MINUTE_MS = 60_000;

export type QrStoreFactory = () => QrStore | Promise<QrStore>;

// Hora actual según el reloj con el que la implementación decide el vencimiento.
export type ContractClock = () => Date | Promise<Date>;

function createRecord(now: Date, overrides: Partial<QrRecord> = {}): QrRecord {
  return {
    id: "qr-1",
    tripId: TRIP_ID,
    tokenHash: randomBytes(32).toString("hex"),
    createdAt: new Date(now.getTime() - MINUTE_MS),
    expiresAt: new Date(now.getTime() + 4 * MINUTE_MS),
    usedAt: null,
    ...overrides,
  };
}

function createOperationalRecord(now: Date, overrides: Partial<QrOperationalRecord> = {}): QrOperationalRecord {
  return {
    ...createRecord(now),
    token: randomBytes(32).toString("base64url"),
    ...overrides,
  };
}

function uniqueTripId(): string {
  return `trip-${randomBytes(8).toString("hex")}`;
}

export function describeQrStoreContract(
  name: string,
  createStore: QrStoreFactory,
  clock: ContractClock = () => new Date(),
): void {
  describe(`${name} — contrato de QrStore`, () => {
    it("guarda un QR y permite consumirlo exitosamente", async () => {
      const store = await createStore();
      const now = await clock();
      const record = createRecord(now);
      await store.save(record);

      const outcome = await store.consumeIfValid(record.tokenHash, TRIP_ID, now);

      expect(outcome).toBe("OK");
    });

    it("getOrCreateActive reutiliza un QR activo del mismo viaje", async () => {
      const store = await createStore();
      const now = await clock();
      const tripId = uniqueTripId();
      const first = createOperationalRecord(now, { id: "qr-1", tripId });
      const retry = createOperationalRecord(now, { id: "qr-2", tripId });

      const created = await store.getOrCreateActive(first, now);
      const repeated = await store.getOrCreateActive(retry, now);

      expect(created).toEqual({ record: first, created: true });
      expect(repeated).toEqual({ record: first, created: false });
    });

    it("getOrCreateActive crea un QR nuevo si el anterior ya fue consumido", async () => {
      const store = await createStore();
      const now = await clock();
      const tripId = uniqueTripId();
      const first = createOperationalRecord(now, { id: "qr-1", tripId });
      const afterUse = createOperationalRecord(now, { id: "qr-2", tripId });

      await store.getOrCreateActive(first, now);
      await store.consumeIfValid(first.tokenHash, tripId, now);
      const result = await store.getOrCreateActive(afterUse, now);

      expect(result).toEqual({ record: afterUse, created: true });
    });

    it("getOrCreateActive crea un QR nuevo si el anterior venció", async () => {
      const store = await createStore();
      const now = await clock();
      const tripId = uniqueTripId();
      const expired = createOperationalRecord(now, {
        id: "qr-1",
        tripId,
        createdAt: new Date(now.getTime() - 5 * MINUTE_MS),
        expiresAt: new Date(now.getTime() - MINUTE_MS),
      });
      const replacement = createOperationalRecord(now, { id: "qr-2", tripId });

      await store.getOrCreateActive(expired, now);
      const result = await store.getOrCreateActive(replacement, now);

      expect(result).toEqual({ record: replacement, created: true });
    });

    it("rechaza una segunda validación del mismo QR", async () => {
      const store = await createStore();
      const now = await clock();
      const record = createRecord(now);
      await store.save(record);
      await store.consumeIfValid(record.tokenHash, TRIP_ID, now);

      const secondOutcome = await store.consumeIfValid(record.tokenHash, TRIP_ID, now);

      expect(secondOutcome).toBe("ALREADY_USED");
    });

    it("rechaza un token inexistente", async () => {
      const store = await createStore();

      const outcome = await store.consumeIfValid(randomBytes(32).toString("hex"), TRIP_ID, await clock());

      expect(outcome).toBe("NOT_FOUND");
    });

    it("rechaza un tripId que no corresponde", async () => {
      const store = await createStore();
      const now = await clock();
      const record = createRecord(now);
      await store.save(record);

      const outcome = await store.consumeIfValid(record.tokenHash, "otro-trip", now);

      expect(outcome).toBe("TRIP_MISMATCH");
    });

    it("rechaza un QR vencido", async () => {
      const store = await createStore();
      const now = await clock();
      const record = createRecord(now, { expiresAt: new Date(now.getTime() - MINUTE_MS) });
      await store.save(record);

      const outcome = await store.consumeIfValid(record.tokenHash, TRIP_ID, now);

      expect(outcome).toBe("EXPIRED");
    });

    it("considera vencido el borde exacto now === expiresAt", async () => {
      const store = await createStore();
      const now = await clock();
      const record = createRecord(now, { expiresAt: now });
      await store.save(record);

      const outcome = await store.consumeIfValid(record.tokenHash, TRIP_ID, now);

      expect(outcome).toBe("EXPIRED");
    });

    it("un QR usado y además vencido devuelve ALREADY_USED, no EXPIRED", async () => {
      const store = await createStore();
      const now = await clock();
      const record = createRecord(now, {
        expiresAt: new Date(now.getTime() - MINUTE_MS),
        usedAt: new Date(now.getTime() - 2 * MINUTE_MS),
      });
      await store.save(record);

      const outcome = await store.consumeIfValid(record.tokenHash, TRIP_ID, now);

      expect(outcome).toBe("ALREADY_USED");
    });
  });
}

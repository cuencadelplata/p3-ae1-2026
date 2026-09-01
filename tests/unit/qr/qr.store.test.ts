import { describe, expect, it } from "vitest";

import { createQrStore } from "../../../src/qr/qr.store";
import type { QrRecord } from "../../../src/qr/qr.types";

const TRIP_ID = "trip-demo-001";
const TOKEN_HASH = "a".repeat(64);
const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");
const EXPIRES_AT = new Date("2026-09-01T12:05:00.000Z");
const BEFORE_EXPIRY = new Date("2026-09-01T12:03:00.000Z");
const AFTER_EXPIRY = new Date("2026-09-01T12:06:00.000Z");

function createRecord(overrides: Partial<QrRecord> = {}): QrRecord {
  return {
    id: "qr-1",
    tripId: TRIP_ID,
    tokenHash: TOKEN_HASH,
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    usedAt: null,
    ...overrides,
  };
}

describe("createQrStore", () => {
  it("guarda un QR y permite consumirlo exitosamente", () => {
    const store = createQrStore();
    store.save(createRecord());

    const outcome = store.consumeIfValid(TOKEN_HASH, TRIP_ID, BEFORE_EXPIRY);

    expect(outcome).toBe("OK");
  });

  it("rechaza una segunda validación del mismo QR", () => {
    const store = createQrStore();
    store.save(createRecord());
    store.consumeIfValid(TOKEN_HASH, TRIP_ID, BEFORE_EXPIRY);

    const secondOutcome = store.consumeIfValid(TOKEN_HASH, TRIP_ID, BEFORE_EXPIRY);

    expect(secondOutcome).toBe("ALREADY_USED");
  });

  it("rechaza un token inexistente", () => {
    const store = createQrStore();

    const outcome = store.consumeIfValid("token-hash-inexistente".padEnd(64, "0"), TRIP_ID, BEFORE_EXPIRY);

    expect(outcome).toBe("NOT_FOUND");
  });

  it("rechaza un tripId que no corresponde", () => {
    const store = createQrStore();
    store.save(createRecord());

    const outcome = store.consumeIfValid(TOKEN_HASH, "otro-trip", BEFORE_EXPIRY);

    expect(outcome).toBe("TRIP_MISMATCH");
  });

  it("rechaza un QR vencido", () => {
    const store = createQrStore();
    store.save(createRecord());

    const outcome = store.consumeIfValid(TOKEN_HASH, TRIP_ID, AFTER_EXPIRY);

    expect(outcome).toBe("EXPIRED");
  });

  it("considera vencido el borde exacto now === expiresAt", () => {
    const store = createQrStore();
    store.save(createRecord());

    const outcome = store.consumeIfValid(TOKEN_HASH, TRIP_ID, EXPIRES_AT);

    expect(outcome).toBe("EXPIRED");
  });

  it("un QR usado y además vencido devuelve ALREADY_USED, no EXPIRED", () => {
    const store = createQrStore();
    store.save(createRecord({ usedAt: BEFORE_EXPIRY }));

    const outcome = store.consumeIfValid(TOKEN_HASH, TRIP_ID, AFTER_EXPIRY);

    expect(outcome).toBe("ALREADY_USED");
  });
});

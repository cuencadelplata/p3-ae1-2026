import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';

import { runMigrations } from '../../src/db/migrations';
import { pool } from '../../src/db/pool';
import { buildReceiptIssuedEvent } from '../../src/messaging/receipt-issued';
import type { Receipt } from '../../src/models/receipt';
import * as repository from '../../src/repositories/receipt.repository';

function sampleReceipt(tripId: string): Receipt {
  const receiptId = randomUUID();
  return {
    receiptId,
    receiptNumber: `CMP-TEST-${receiptId.slice(0, 8).toUpperCase()}`,
    tripId,
    issuedAt: new Date().toISOString(),
    customer: { id: 'cli-1', fullName: 'Cliente Prueba' },
    driver: { id: 'cnd-1', fullName: 'Conductor Prueba', vehicle: { type: 'AUTO', plate: 'AA000AA' } },
    trip: {
      origin: 'Origen',
      destination: 'Destino',
      startedAt: '2026-09-30T10:00:00.000Z',
      finishedAt: '2026-09-30T10:20:00.000Z',
      distanceKm: 5,
      durationMin: 20,
    },
    fare: { currency: 'ARS', baseFare: 0, distanceAmount: 0, timeAmount: 0, surcharges: 0, discounts: 0, total: 1000 },
    payment: { method: 'EFECTIVO', status: 'APROBADO' },
    deliveries: [],
  };
}

const fakePdf = Buffer.from('%PDF-1.3 prueba');

function create(receipt: Receipt, issuedEvent = buildReceiptIssuedEvent(receipt)): Promise<void> {
  return repository.create(receipt, fakePdf, issuedEvent);
}

async function countOutboxEvents(tripId: string): Promise<number> {
  const result = await pool.query('SELECT 1 FROM receipts.outbox_events WHERE correlation_id = $1', [tripId]);
  return result.rowCount ?? 0;
}

describe('Receipt Repository (PostgreSQL)', () => {
  before(async () => {
    await runMigrations();
  });

  it('debe persistir el comprobante y su PDF', async () => {
    const receipt = sampleReceipt(`trip-repo-${Date.now()}`);
    await create(receipt);

    const stored = await repository.findByTripId(receipt.tripId);
    assert.equal(stored?.receiptId, receipt.receiptId);
    assert.equal(stored?.fare.total, 1000);
    assert.deepEqual(stored?.deliveries, []);

    const pdf = await repository.findPdfByTripId(receipt.tripId);
    assert.deepEqual(pdf, fakePdf);
  });

  it('debe guardar el PDF con una clave opaca que no deriva del tripId', async () => {
    const receipt = sampleReceipt(`trip-repo-clave-${Date.now()}`);
    await create(receipt);

    const result = await pool.query<{ pdf_key: string }>(
      'SELECT pdf_key FROM receipts.receipt_documents WHERE receipt_id = $1',
      [receipt.receiptId],
    );
    const pdfKey = result.rows[0]?.pdf_key ?? '';
    assert.match(pdfKey, /^[0-9a-f-]{36}$/);
    assert.ok(!pdfKey.includes(receipt.tripId));
  });

  it('debe rechazar un segundo comprobante para el mismo viaje sin dejar un PDF huerfano', async () => {
    const tripId = `trip-repo-unico-${Date.now()}`;
    const first = sampleReceipt(tripId);
    const second = sampleReceipt(tripId);

    await create(first);
    await assert.rejects(() => create(second), repository.ReceiptAlreadyExistsError);

    const receipts = await pool.query('SELECT 1 FROM receipts.receipts WHERE trip_id = $1', [tripId]);
    assert.equal(receipts.rowCount, 1);

    const orphan = await pool.query('SELECT 1 FROM receipts.receipt_documents WHERE receipt_id = $1', [
      second.receiptId,
    ]);
    assert.equal(orphan.rowCount, 0);
    assert.equal(await countOutboxEvents(tripId), 1);
  });

  it('debe guardar el evento receipt.issued pendiente en la misma transaccion', async () => {
    const receipt = sampleReceipt(`trip-repo-evento-${Date.now()}`);
    const event = buildReceiptIssuedEvent(receipt);
    await create(receipt, event);

    const result = await pool.query<{ routing_key: string; published_at: Date | null; envelope: { data: object } }>(
      'SELECT routing_key, published_at, envelope FROM receipts.outbox_events WHERE message_id = $1',
      [event.envelope.messageId],
    );
    assert.equal(result.rows[0]?.routing_key, 'receipt.issued');
    assert.equal(result.rows[0]?.published_at, null);
    assert.deepEqual(result.rows[0]?.envelope.data, event.envelope.data);
  });

  it('debe acumular los reenvios en orden de registro', async () => {
    const receipt = sampleReceipt(`trip-repo-envios-${Date.now()}`);
    await create(receipt);

    await repository.addDelivery(receipt.receiptId, {
      channel: 'EMAIL',
      destination: 'cliente@example.com',
      sentAt: '2026-09-30T11:00:00.000Z',
    });
    await repository.addDelivery(receipt.receiptId, {
      channel: 'PUSH',
      destination: 'device-123',
      sentAt: '2026-09-30T11:05:00.000Z',
    });

    const stored = await repository.findByTripId(receipt.tripId);
    assert.deepEqual(
      stored?.deliveries.map((delivery) => delivery.channel),
      ['EMAIL', 'PUSH'],
    );
    assert.equal(stored?.deliveries[0]?.sentAt, '2026-09-30T11:00:00.000Z');
  });

  it('debe devolver null para un viaje sin comprobante', async () => {
    assert.equal(await repository.findByTripId('trip-sin-comprobante'), null);
    assert.equal(await repository.findPdfByTripId('trip-sin-comprobante'), null);
  });
});

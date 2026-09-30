import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseEnvelope } from '../../src/messaging/envelope';
import { buildReceiptIssuedEvent } from '../../src/messaging/receipt-issued';
import type { Receipt } from '../../src/models/receipt';

const receipt: Receipt = {
  receiptId: '0b7d4c1e-2f6a-4e51-9d0c-8a3b1f7e6c25',
  receiptNumber: 'CMP-2026-3176686383',
  tripId: 'trip-2026-000123',
  issuedAt: '2026-10-05T18:42:12.000Z',
  customer: { id: 'cli-0091', fullName: 'Lucia Fernandez', email: 'lucia.fernandez@example.com', documentId: '30111222' },
  driver: { id: 'cnd-0457', fullName: 'Martin Rodriguez', vehicle: { type: 'AUTO', plate: 'AB123CD' } },
  trip: {
    origin: 'Av. Colon 1250',
    destination: 'Aeropuerto',
    startedAt: '2026-10-05T18:05:00.000Z',
    finishedAt: '2026-10-05T18:36:00.000Z',
    distanceKm: 14.8,
    durationMin: 31,
  },
  fare: { currency: 'ARS', baseFare: 0, distanceAmount: 0, timeAmount: 0, surcharges: 0, discounts: 0, total: 5390.5 },
  payment: { method: 'TARJETA', status: 'APROBADO' },
  deliveries: [],
};

describe('receipt.issued: armado del evento (Unit)', () => {
  it('debe respetar el sobre comun del catalogo de eventos', () => {
    const { routingKey, envelope } = buildReceiptIssuedEvent(receipt);

    assert.equal(routingKey, 'receipt.issued');
    assert.equal(envelope.eventType, 'ReceiptIssued');
    assert.equal(envelope.version, 1);
    assert.equal(envelope.producer, 'm8-receipts');
    assert.equal(envelope.correlationId, receipt.tripId);
    assert.equal(envelope.occurredAt, receipt.issuedAt);
    assert.equal(parseEnvelope(Buffer.from(JSON.stringify(envelope))).ok, true);
  });

  it('debe llevar solo los identificadores del comprobante', () => {
    const { envelope } = buildReceiptIssuedEvent(receipt);

    assert.deepEqual(envelope.data, {
      tripId: receipt.tripId,
      receiptId: receipt.receiptId,
      receiptNumber: receipt.receiptNumber,
      issuedAt: receipt.issuedAt,
    });
  });

  it('no debe incluir datos personales ni enlaces de descarga', () => {
    const serialized = JSON.stringify(buildReceiptIssuedEvent(receipt).envelope);

    for (const personal of ['Lucia Fernandez', 'lucia.fernandez@example.com', '30111222', 'Martin Rodriguez', 'AB123CD']) {
      assert.ok(!serialized.includes(personal), `el evento no debe contener "${personal}"`);
    }
    assert.ok(!/https?:\/\//.test(serialized), 'el evento no debe contener enlaces');
  });

  it('debe generar un messageId distinto en cada evento', () => {
    const first = buildReceiptIssuedEvent(receipt).envelope.messageId;
    const second = buildReceiptIssuedEvent(receipt).envelope.messageId;
    assert.notEqual(first, second);
  });
});

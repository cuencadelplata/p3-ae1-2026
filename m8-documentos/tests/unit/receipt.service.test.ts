import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ReceiptRequest } from '../../src/models/receipt';
import * as receiptService from '../../src/services/receipt.service';

const testTripId = `trip-unit-${Date.now()}`;
const sampleRequest: ReceiptRequest = {
  tripId: testTripId,
  customer: {
    id: 'cli-0099',
    fullName: 'Lucas Cremaschi',
    email: 'lucas@example.com',
  },
  driver: {
    id: 'cnd-0088',
    fullName: 'Santiago Meza',
    vehicle: {
      type: 'MOTO',
      plate: 'A099BCD',
    },
  },
  trip: {
    origin: 'Facultad UTN FRC',
    destination: 'Plaza San Martin',
    startedAt: '2026-09-01T18:00:00.000Z',
    finishedAt: '2026-09-01T18:25:00.000Z',
    distanceKm: 6.5,
    durationMin: 25,
  },
  fare: {
    currency: 'ARS',
    total: 3500,
  },
  payment: {
    method: 'BILLETERA',
    status: 'APROBADO',
  },
};

describe('Receipt Service (Unit)', () => {
  it('debe emitir un nuevo comprobante y generar el PDF (RF-8.3)', async () => {
    const result = await receiptService.issueReceipt(sampleRequest);
    assert.equal(result.created, true);
    assert.equal(result.receipt.tripId, testTripId);
    assert.ok(result.receipt.receiptNumber.startsWith('CMP-'));
    assert.equal(result.receipt.customer.fullName, 'Lucas Cremaschi');
    assert.equal(result.receipt.fare.total, 3500);
  });

  it('debe ser idempotente: devolver el mismo comprobante si se reemite con el mismo tripId', async () => {
    const secondResult = await receiptService.issueReceipt(sampleRequest);
    assert.equal(secondResult.created, false);
    assert.equal(secondResult.receipt.tripId, testTripId);
  });

  it('debe poder consultar el comprobante emitido por tripId', async () => {
    const receipt = await receiptService.getReceipt(testTripId);
    assert.equal(receipt.tripId, testTripId);
    assert.equal(receipt.driver.fullName, 'Santiago Meza');
  });

  it('debe registrar y simular el reenvio del comprobante (RF-8.4)', async () => {
    const { receipt, delivery } = await receiptService.resendReceipt(
      testTripId,
      'EMAIL',
      'lucas@example.com',
    );
    assert.equal(delivery.channel, 'EMAIL');
    assert.ok(delivery.sentAt);
    assert.ok(receipt.deliveries.length >= 1);
  });

  it('debe fallar al buscar un comprobante inexistente', async () => {
    await assert.rejects(
      async () => receiptService.getReceipt('trip-inexistente-999'),
      /No existe un comprobante emitido/
    );
  });
});

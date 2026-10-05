import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ensureAuthorized,
  PaymentNotAuthorizedError,
  toM7Payment,
  type M7Payment,
} from '../../src/integrations/m7-payments';

function m7Body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pagoId: '0.123456789',
    clienteId: 'cliente1',
    viajeId: 'trip-m7-1',
    tipo: 'tarjeta',
    detalle: '',
    fecha: '4/10/2026',
    estado: 'autorizado',
    ...overrides,
  };
}

function payment(status: M7Payment['status']): M7Payment {
  return { paymentId: 'pay-1', tripId: 'trip-m7-1', method: 'TARJETA', status };
}

describe('Traduccion del contrato de M7 (Unit)', () => {
  it('debe traducir cada estado de M7 al estado interno', () => {
    assert.equal(toM7Payment(m7Body({ estado: 'autorizado' }))?.status, 'APROBADO');
    assert.equal(toM7Payment(m7Body({ estado: 'pendiente' }))?.status, 'PENDIENTE');
    assert.equal(toM7Payment(m7Body({ estado: 'rechazado' }))?.status, 'RECHAZADO');
  });

  it('debe traducir cada tipo de pago de M7 al medio de pago interno', () => {
    assert.equal(toM7Payment(m7Body({ tipo: 'efectivo' }))?.method, 'EFECTIVO');
    assert.equal(toM7Payment(m7Body({ tipo: 'tarjeta' }))?.method, 'TARJETA');
    assert.equal(toM7Payment(m7Body({ tipo: 'transferencia' }))?.method, 'TRANSFERENCIA');
  });

  it('debe conservar los identificadores del pago y del viaje', () => {
    assert.deepEqual(toM7Payment(m7Body()), {
      paymentId: '0.123456789',
      tripId: 'trip-m7-1',
      method: 'TARJETA',
      status: 'APROBADO',
    });
  });

  it('debe devolver null ante valores que no estan en el contrato', () => {
    assert.equal(toM7Payment(m7Body({ estado: 'capturado' })), null);
    assert.equal(toM7Payment(m7Body({ tipo: 'billetera' })), null);
    assert.equal(toM7Payment(m7Body({ estado: 'AUTORIZADO' })), null);
    assert.equal(toM7Payment(m7Body({ pagoId: undefined })), null);
    assert.equal(toM7Payment(m7Body({ viajeId: 42 })), null);
    assert.equal(toM7Payment(null), null);
    assert.equal(toM7Payment('autorizado'), null);
  });
});

describe('Decision de emision segun el pago (Unit)', () => {
  it('un pago autorizado debe habilitar la emision', () => {
    assert.deepEqual(ensureAuthorized(payment('APROBADO'), 'trip-m7-1'), payment('APROBADO'));
  });

  it('un pago pendiente debe rechazar la emision de forma reintentable', () => {
    assert.throws(
      () => ensureAuthorized(payment('PENDIENTE'), 'trip-m7-1'),
      (error: unknown) =>
        error instanceof PaymentNotAuthorizedError && error.code === 'PAYMENT_PENDING' && error.retryable,
    );
  });

  it('un viaje sin pago registrado debe rechazar la emision de forma reintentable', () => {
    assert.throws(
      () => ensureAuthorized(null, 'trip-m7-1'),
      (error: unknown) =>
        error instanceof PaymentNotAuthorizedError && error.code === 'PAYMENT_NOT_FOUND' && error.retryable,
    );
  });

  it('un pago rechazado debe rechazar la emision de forma definitiva', () => {
    assert.throws(
      () => ensureAuthorized(payment('RECHAZADO'), 'trip-m7-1'),
      (error: unknown) =>
        error instanceof PaymentNotAuthorizedError && error.code === 'PAYMENT_REJECTED' && !error.retryable,
    );
  });
});

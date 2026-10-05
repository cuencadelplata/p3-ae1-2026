import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyM7Amount,
  ensureAuthorized,
  PaymentNotAuthorizedError,
  toM7Payment,
  type M7Payment,
} from '../../src/integrations/m7-payments';
import type { Fare } from '../../src/models/receipt';

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

describe('Importe informado por M7 (Unit)', () => {
  it('debe traducir total y moneda cuando M7 los informa', () => {
    assert.deepEqual(toM7Payment(m7Body({ total: 5390.5, moneda: 'ARS' }))?.amount, { total: 5390.5, currency: 'ARS' });
  });

  it('debe usar ARS cuando M7 informa el total sin moneda, como hace M7', () => {
    assert.deepEqual(toM7Payment(m7Body({ total: 1500 }))?.amount, { total: 1500, currency: 'ARS' });
  });

  it('un pago sin total no debe tener importe (pendiente o anterior al cambio de M7)', () => {
    assert.equal(toM7Payment(m7Body())?.amount, undefined);
  });

  it('debe devolver null ante un importe fuera de contrato', () => {
    assert.equal(toM7Payment(m7Body({ total: '5390.50' })), null);
    assert.equal(toM7Payment(m7Body({ total: -1 })), null);
    assert.equal(toM7Payment(m7Body({ total: 100, moneda: 'pesos' })), null);
  });
});

describe('Tarifa del comprobante con el importe de M7 (Unit)', () => {
  const fare: Fare = {
    currency: 'ARS',
    baseFare: 1200,
    distanceAmount: 3450.5,
    timeAmount: 890,
    surcharges: 0,
    discounts: 150,
    total: 5390.5,
  };

  it('sin importe de M7 la tarifa de la entrada no cambia', () => {
    assert.deepEqual(applyM7Amount(fare, undefined), fare);
  });

  it('si el desglose suma el total de M7 se conserva', () => {
    assert.deepEqual(applyM7Amount(fare, { total: 5390.5, currency: 'ARS' }), fare);
  });

  it('si el desglose no suma el total de M7 queda solo el total cobrado', () => {
    assert.deepEqual(applyM7Amount(fare, { total: 6000, currency: 'ARS' }), {
      currency: 'ARS',
      baseFare: 0,
      distanceAmount: 0,
      timeAmount: 0,
      surcharges: 0,
      discounts: 0,
      total: 6000,
    });
  });

  it('si M7 cobro en otra moneda el desglose se descarta', () => {
    const result = applyM7Amount(fare, { total: 5390.5, currency: 'USD' });
    assert.equal(result.currency, 'USD');
    assert.equal(result.total, 5390.5);
    assert.equal(result.baseFare, 0);
  });

  it('una tarifa sin desglose toma el total de M7', () => {
    const onlyTotal: Fare = { ...fare, baseFare: 0, distanceAmount: 0, timeAmount: 0, discounts: 0, total: 1500 };
    assert.equal(applyM7Amount(onlyTotal, { total: 1800, currency: 'ARS' }).total, 1800);
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

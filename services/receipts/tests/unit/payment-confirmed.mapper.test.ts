import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseEnvelope } from '../../src/messaging/envelope';
import { toReceiptRequest } from '../../src/messaging/payment-confirmed';
import { paymentConfirmedEvent, toBuffer } from '../helpers/payment-confirmed.fixture';

describe('payment.confirmed: sobre y traduccion (Unit)', () => {
  it('debe aceptar un sobre valido', () => {
    const result = parseEnvelope(toBuffer(paymentConfirmedEvent('trip-001')));
    assert.equal(result.ok, true);
  });

  it('debe rechazar un mensaje que no es JSON', () => {
    const result = parseEnvelope(Buffer.from('esto no es json'));
    assert.equal(result.ok, false);
  });

  it('debe informar cada campo faltante del sobre', () => {
    const result = parseEnvelope(toBuffer({ eventType: 'PaymentConfirmed', data: {} }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((error) => error.includes('messageId')));
      assert.ok(result.errors.some((error) => error.includes('correlationId')));
      assert.ok(result.errors.some((error) => error.includes('occurredAt')));
    }
  });

  it('debe traducir el evento al pedido de emision del comprobante', () => {
    const result = toReceiptRequest(paymentConfirmedEvent('trip-002'));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.tripId, 'trip-002');
      assert.equal(result.value.fare.total, 5390.5);
      assert.equal(result.value.payment.method, 'TARJETA');
      assert.equal(result.value.payment.authorizationCode, 'AUT-55821');
      assert.equal(result.value.customer.fullName, 'Lucia Fernandez');
    }
  });

  it('debe rechazar un evento de otro tipo o de una version no soportada', () => {
    const otherType = toReceiptRequest(paymentConfirmedEvent('trip-003', { eventType: 'TripCompleted' }));
    const otherVersion = toReceiptRequest(paymentConfirmedEvent('trip-003', { version: 2 }));
    assert.equal(otherType.ok, false);
    assert.equal(otherVersion.ok, false);
  });

  it('debe rechazar un correlationId distinto del tripId', () => {
    const result = toReceiptRequest(paymentConfirmedEvent('trip-004', { correlationId: 'trip-otro' }));
    assert.equal(result.ok, false);
  });

  it('debe rechazar un pago sin fecha de confirmacion', () => {
    const event = paymentConfirmedEvent('trip-007');
    delete event.data['confirmedAt'];
    assert.equal(toReceiptRequest(event).ok, false);
  });

  it('debe rechazar un pago que no esta aprobado', () => {
    const event = paymentConfirmedEvent('trip-005');
    event.data['status'] = 'PENDIENTE';
    assert.equal(toReceiptRequest(event).ok, false);
  });

  it('debe rechazar un desglose de tarifa que no cierra con el total', () => {
    const event = paymentConfirmedEvent('trip-006');
    (event.data['fare'] as Record<string, number>)['total'] = 1;
    const result = toReceiptRequest(event);
    assert.equal(result.ok, false);
  });
});

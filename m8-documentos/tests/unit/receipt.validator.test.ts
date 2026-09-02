import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  validateReceiptRequest,
  validateResendRequest,
} from '../../src/validators/receipt.validator';

const sampleValidRequest = {
  tripId: 'trip-2026-test001',
  customer: {
    id: 'cli-001',
    fullName: 'Lucia Fernandez',
    email: 'lucia.fernandez@example.com',
    phone: '+54 9 351 555-0199',
    documentId: '38.442.019',
  },
  driver: {
    id: 'cnd-001',
    fullName: 'Martin Rodriguez',
    vehicle: {
      type: 'AUTO' as const,
      plate: 'AB123CD',
      model: 'Toyota Etios 2021',
    },
  },
  trip: {
    origin: 'Av. Colon 1250, Cordoba',
    destination: 'Aeropuerto Ambrosio Taravella',
    startedAt: '2026-08-28T13:05:00.000Z',
    finishedAt: '2026-08-28T13:36:00.000Z',
    distanceKm: 14.8,
    durationMin: 31,
  },
  fare: {
    currency: 'ARS',
    baseFare: 1200,
    distanceAmount: 5920,
    timeAmount: 1550,
    surcharges: 430,
    discounts: 600,
    total: 8500,
  },
  payment: {
    method: 'TARJETA' as const,
    status: 'APROBADO' as const,
    authorizationCode: 'AUTH-77321',
  },
};

describe('Receipt Validator (Unit)', () => {
  it('debe validar exitosamente una solicitud completa y correcta', () => {
    const result = validateReceiptRequest(sampleValidRequest);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.tripId, 'trip-2026-test001');
      assert.equal(result.value.fare.total, 8500);
      assert.equal(result.value.driver.vehicle.type, 'AUTO');
    }
  });

  it('debe rechazar si falta tripId o contiene caracteres invalidos', () => {
    const invalidTripId = { ...sampleValidRequest, tripId: 'trip with spaces!' };
    const result = validateReceiptRequest(invalidTripId);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes('tripId')));
    }
  });

  it('debe rechazar si el tipo de vehiculo no es AUTO ni MOTO', () => {
    const invalidVehicle = {
      ...sampleValidRequest,
      driver: {
        ...sampleValidRequest.driver,
        vehicle: { ...sampleValidRequest.driver.vehicle, type: 'CAMION' },
      },
    };
    const result = validateReceiptRequest(invalidVehicle);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes('driver.vehicle.type')));
    }
  });

  it('debe rechazar si la suma del desglose de tarifa no coincide con el total', () => {
    const inconsistentFare = {
      ...sampleValidRequest,
      fare: {
        ...sampleValidRequest.fare,
        total: 99999, // Inconsistente con el desglose
      },
    };
    const result = validateReceiptRequest(inconsistentFare);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes('fare.total')));
    }
  });

  it('debe rechazar metodos de pago no permitidos', () => {
    const invalidPayment = {
      ...sampleValidRequest,
      payment: { method: 'CRIPTOMONEDA', status: 'APROBADO' },
    };
    const result = validateReceiptRequest(invalidPayment);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.includes('payment.method')));
    }
  });

  it('debe validar solicitudes de reenvio validas (RF-8.4)', () => {
    const resendEmail = validateResendRequest({ channel: 'EMAIL', destination: 'test@example.com' });
    assert.equal(resendEmail.ok, true);

    const resendEmpty = validateResendRequest({});
    assert.equal(resendEmpty.ok, true);
  });

  it('debe rechazar solicitudes de reenvio con canal o destino invalido', () => {
    const invalidChannel = validateResendRequest({ channel: 'PALOMA_MENSAJERA' });
    assert.equal(invalidChannel.ok, false);

    const invalidEmail = validateResendRequest({ channel: 'EMAIL', destination: 'correo-sin-arroba' });
    assert.equal(invalidEmail.ok, false);
  });
});

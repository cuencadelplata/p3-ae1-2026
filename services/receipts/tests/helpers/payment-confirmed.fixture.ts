import { randomUUID } from 'node:crypto';

import type { EventEnvelope } from '../../src/messaging/envelope';

/** Evento payment.confirmed valido segun el catalogo de eventos v1. */
export function paymentConfirmedEvent(tripId: string, overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    messageId: randomUUID(),
    eventType: 'PaymentConfirmed',
    version: 1,
    occurredAt: '2026-10-05T18:42:11.000Z',
    correlationId: tripId,
    producer: 'm7-pagos',
    data: {
      tripId,
      paymentId: `pay-${tripId}`,
      confirmedAt: '2026-10-05T18:42:10.000Z',
      method: 'TARJETA',
      status: 'APROBADO',
      authorizationCode: 'AUT-55821',
      fare: {
        currency: 'ARS',
        baseFare: 1200,
        distanceAmount: 3450.5,
        timeAmount: 890,
        surcharges: 0,
        discounts: 150,
        total: 5390.5,
      },
      customer: { id: 'cli-0091', fullName: 'Lucia Fernandez', email: 'lucia.fernandez@example.com' },
      driver: {
        id: 'cnd-0457',
        fullName: 'Martin Rodriguez',
        vehicle: { type: 'AUTO', plate: 'AB123CD', model: 'Toyota Etios 2021' },
      },
      trip: {
        origin: 'Av. Colon 1250',
        destination: 'Aeropuerto',
        startedAt: '2026-10-05T18:05:00.000Z',
        finishedAt: '2026-10-05T18:36:00.000Z',
        distanceKm: 14.8,
        durationMin: 31,
      },
    },
    ...overrides,
  };
}

export function toBuffer(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

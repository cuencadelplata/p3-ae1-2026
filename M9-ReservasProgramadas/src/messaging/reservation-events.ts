import { z } from 'zod';

import type { Reserva } from '../domain/reserva.js';
import type { RouteSnapshot } from '../domain/route-snapshot.js';
import { createEventEnvelope, type EventEnvelope } from './event-envelope.js';

export const RESERVATION_EVENT_TYPES = {
  created: 'reservation.created.v1',
  updated: 'reservation.updated.v1',
  cancelled: 'reservation.cancelled.v1',
  readyForDispatch: 'reservation.ready-for-dispatch.v1',
  activated: 'reservation.activated.v1',
  failed: 'reservation.failed.v1',
  rideAssigned: 'ride-request.assigned.v1',
  rideFailed: 'ride-request.failed.v1',
} as const;

export type ReservationEventType =
  (typeof RESERVATION_EVENT_TYPES)[keyof typeof RESERVATION_EVENT_TYPES];

export interface ReservationReferencePayload {
  reservationId: string;
  status: Reserva['estado'];
}

export interface ReadyForDispatchPayload extends ReservationReferencePayload {
  vehicleType: Reserva['vehiculo'];
  route: RouteSnapshot;
  idempotencyKey: string;
}

export interface RideAssignedPayload {
  reservationId: string;
  requestId: string;
  assignedDriverId: string;
}

export interface RideFailedPayload {
  reservationId: string;
  requestId: string;
  reason: 'EXPIRED' | 'NO_DRIVERS_AVAILABLE';
}

export type DispatchResultEvent =
  | (EventEnvelope<RideAssignedPayload> & {
      eventType: typeof RESERVATION_EVENT_TYPES.rideAssigned;
    })
  | (EventEnvelope<RideFailedPayload> & {
      eventType: typeof RESERVATION_EVENT_TYPES.rideFailed;
    });

const envelopeBase = {
  eventId: z.string().uuid(),
  eventVersion: z.literal(1),
  occurredAt: z.string().datetime({ offset: true }),
  correlationId: z.string().min(1),
  aggregateId: z.string().uuid(),
};

const assignedEventSchema = z.object({
  ...envelopeBase,
  eventType: z.literal(RESERVATION_EVENT_TYPES.rideAssigned),
  payload: z.object({
    reservationId: z.string().uuid(),
    requestId: z.string().uuid(),
    assignedDriverId: z.string().uuid(),
  }),
});

const failedEventSchema = z.object({
  ...envelopeBase,
  eventType: z.literal(RESERVATION_EVENT_TYPES.rideFailed),
  payload: z.object({
    reservationId: z.string().uuid(),
    requestId: z.string().uuid(),
    reason: z.enum(['EXPIRED', 'NO_DRIVERS_AVAILABLE']),
  }),
});

export const readyForDispatchEventSchema = z.object({
  ...envelopeBase,
  eventType: z.literal(RESERVATION_EVENT_TYPES.readyForDispatch),
  payload: z.object({
    reservationId: z.string().uuid(),
    status: z.literal('ACTIVANDO'),
    vehicleType: z.enum(['AUTO', 'MOTO']),
    route: z.object({
      origin: z.object({ latitude: z.number(), longitude: z.number(), address: z.string() }),
      destination: z.object({ latitude: z.number(), longitude: z.number(), address: z.string() }),
      distanceKm: z.number().nonnegative(),
      estimatedDurationMin: z.number().nonnegative(),
    }),
    idempotencyKey: z.string().uuid(),
  }),
});

export const dispatchResultEventSchema = z.discriminatedUnion('eventType', [
  assignedEventSchema,
  failedEventSchema,
]);

export const createReservationReferenceEvent = (input: {
  eventType: ReservationEventType;
  correlationId: string;
  reservation: Pick<Reserva, 'id' | 'estado'>;
}): EventEnvelope<ReservationReferencePayload> =>
  createEventEnvelope({
    eventType: input.eventType,
    correlationId: input.correlationId,
    aggregateId: input.reservation.id,
    payload: {
      reservationId: input.reservation.id,
      status: input.reservation.estado,
    },
  });

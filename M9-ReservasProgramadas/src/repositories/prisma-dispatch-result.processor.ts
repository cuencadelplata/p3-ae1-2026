import { randomUUID } from 'node:crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import type {
  DispatchResultProcessing,
  DispatchResultProcessor,
} from '../messaging/dispatch-result.processor.js';
import {
  createReservationReferenceEvent,
  RESERVATION_EVENT_TYPES,
} from '../messaging/reservation-events.js';
import type { DispatchResultEvent } from '../messaging/reservation-events.js';

export class PrismaDispatchResultProcessor implements DispatchResultProcessor {
  public constructor(private readonly prisma: PrismaClient) {}

  public async process(event: DispatchResultEvent): Promise<DispatchResultProcessing> {
    return this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.inboxEvent.createMany({
        data: {
          eventId: event.eventId,
          eventType: event.eventType,
          aggregateId: event.aggregateId,
          correlationId: event.correlationId,
        },
        skipDuplicates: true,
      });
      if (claimed.count === 0) return 'DUPLICATE';

      const assigned = event.eventType === RESERVATION_EVENT_TYPES.rideAssigned;
      const assignedDriverId = assigned ? event.payload.assignedDriverId : null;
      const update = await transaction.reservation.updateMany({
        where: { id: event.payload.reservationId, status: 'ACTIVANDO' },
        data: {
          status: assigned ? 'ACTIVADA' : 'FALLIDA',
          dispatchRequestId: event.payload.requestId,
          assignedDriverId,
          version: { increment: 1 },
        },
      });
      if (update.count === 0) return 'IGNORED';

      const reservation = await transaction.reservation.findUniqueOrThrow({
        where: { id: event.payload.reservationId },
      });
      const domain = {
        id: reservation.id,
        estado: reservation.status,
      };
      const followUp = createReservationReferenceEvent({
        eventType: assigned ? RESERVATION_EVENT_TYPES.activated : RESERVATION_EVENT_TYPES.failed,
        correlationId: event.correlationId,
        reservation: domain,
      });
      await transaction.outboxEvent.create({
        data: {
          id: randomUUID(),
          eventId: followUp.eventId,
          aggregateId: followUp.aggregateId,
          eventType: followUp.eventType,
          eventVersion: followUp.eventVersion,
          routingKey: followUp.eventType,
          payload: followUp as unknown as Prisma.InputJsonValue,
          correlationId: followUp.correlationId,
        },
      });
      return 'PROCESSED';
    });
  }
}

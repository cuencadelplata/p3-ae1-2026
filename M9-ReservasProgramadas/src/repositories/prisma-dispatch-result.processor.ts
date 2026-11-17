import type { PrismaClient } from '@prisma/client';

import type {
  DispatchResultProcessing,
  DispatchResultProcessor,
} from '../messaging/dispatch-result.processor.js';
import {
  createReservationReferenceEvent,
  RESERVATION_EVENT_TYPES,
} from '../messaging/reservation-events.js';
import type { DispatchResultEvent } from '../messaging/reservation-events.js';
import { measureDb } from '../observability/db.js';
import {
  recordActivationResolution,
  recordInboxResult,
  recordTransition,
} from '../observability/metrics.js';
import { outboxData } from './prisma-reserva.repository.js';

interface ProcessingOutcome {
  result: DispatchResultProcessing;
  finalStatus?: 'ACTIVADA' | 'FALLIDA';
  scheduledAt?: Date;
}

export class PrismaDispatchResultProcessor implements DispatchResultProcessor {
  public constructor(private readonly prisma: PrismaClient) {}

  public async process(event: DispatchResultEvent): Promise<DispatchResultProcessing> {
    const outcome = await measureDb('inbox.process_dispatch_result', () =>
      this.prisma.$transaction(async (transaction): Promise<ProcessingOutcome> => {
        const claimed = await transaction.inboxEvent.createMany({
          data: {
            eventId: event.eventId,
            eventType: event.eventType,
            aggregateId: event.aggregateId,
            correlationId: event.correlationId,
          },
          skipDuplicates: true,
        });
        if (claimed.count === 0) return { result: 'DUPLICATE' };

        const assigned = event.eventType === RESERVATION_EVENT_TYPES.rideAssigned;
        const assignedDriverId = assigned ? event.payload.assignedDriverId : null;
        const update = await transaction.reservation.updateMany({
          where: { id: event.payload.reservationId, status: 'ACTIVANDO' },
          data: {
            status: assigned ? 'ACTIVADA' : 'FALLIDA',
            dispatchRequestId: event.payload.requestId,
            assignedDriverId,
            assignmentCriteria: assigned ? 'MEJOR_VALORACION' : null,
            version: { increment: 1 },
          },
        });
        if (update.count === 0) return { result: 'IGNORED' };

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
        // El evento de seguimiento hereda el contexto del span CONSUMER activo.
        await transaction.outboxEvent.create({ data: outboxData(followUp.eventType, followUp) });
        return {
          result: 'PROCESSED',
          finalStatus: assigned ? 'ACTIVADA' : 'FALLIDA',
          scheduledAt: reservation.scheduledAt,
        };
      }),
    );

    // Métricas tras el commit: un rollback o un duplicado nunca cuentan como activación.
    recordInboxResult(event.eventType, outcome.result);
    if (outcome.finalStatus !== undefined && outcome.scheduledAt !== undefined) {
      recordTransition('ACTIVANDO', outcome.finalStatus);
      recordActivationResolution(outcome.finalStatus, outcome.scheduledAt, 'events');
    }
    return outcome.result;
  }
}

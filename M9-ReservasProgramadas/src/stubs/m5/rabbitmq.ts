import type { RabbitMqConnection } from '../../infrastructure/rabbitmq/rabbitmq.connection.js';
import { createEventEnvelope } from '../../messaging/event-envelope.js';
import { IdempotentEventHandler } from '../../messaging/processed-event.repository.js';
import { RabbitMqConsumer } from '../../messaging/rabbitmq-consumer.js';
import { RabbitMqEventPublisher } from '../../messaging/rabbitmq-event-publisher.js';
import {
  readyForDispatchEventSchema,
  RESERVATION_EVENT_TYPES,
  type RideAssignedPayload,
  type RideFailedPayload,
} from '../../messaging/reservation-events.js';
import {
  M5StubDispatchService,
  M5StubError,
  type DispatchOutcome,
  type M5StubState,
  type RideOfferStub,
} from './dispatch.js';

export const createM5StubOutcomeHandler =
  (connection: RabbitMqConnection) =>
  async (outcome: DispatchOutcome): Promise<void> => {
    const publisher = new RabbitMqEventPublisher(connection);
    const common = {
      correlationId: outcome.context.correlationId,
      aggregateId: outcome.context.reservationId,
    };
    const event =
      outcome.type === 'ASSIGNED'
        ? createEventEnvelope<RideAssignedPayload>({
            ...common,
            eventType: RESERVATION_EVENT_TYPES.rideAssigned,
            payload: {
              reservationId: outcome.context.reservationId,
              requestId: outcome.ride.id,
              assignedDriverId: outcome.ride.assignedDriverId!,
            },
          })
        : createEventEnvelope<RideFailedPayload>({
            ...common,
            eventType: RESERVATION_EVENT_TYPES.rideFailed,
            payload: {
              reservationId: outcome.context.reservationId,
              requestId: outcome.ride.id,
              reason: outcome.reason,
            },
          });
    await publisher.publish(event.eventType, event);
  };

export const startM5StubMessaging = async (
  connection: RabbitMqConnection,
  dispatch: M5StubDispatchService,
  retryLimit: number,
  autoRespond = true,
): Promise<void> => {
  const processed = new Set<string>();
  const idempotency = new IdempotentEventHandler({
    hasProcessed: async (eventId) => processed.has(eventId),
    markProcessed: async (eventId) => {
      processed.add(eventId);
    },
  });
  const consumer = new RabbitMqConsumer(connection, retryLimit, idempotency);
  await consumer.start([RESERVATION_EVENT_TYPES.readyForDispatch], async (rawEvent) => {
    const event = readyForDispatchEventSchema.parse(rawEvent);
    const ride = dispatch.createRequest(
      {
        origin: event.payload.route.origin,
        destination: event.payload.route.destination,
        vehicleType: event.payload.vehicleType,
      },
      event.payload.idempotencyKey,
      {
        reservationId: event.payload.reservationId,
        correlationId: event.correlationId,
      },
    );
    let firstOffer: RideOfferStub | undefined;
    try {
      [firstOffer] = await dispatch.sendOffers(ride.id);
    } catch (error) {
      if (error instanceof M5StubError && error.code === 'NO_DRIVERS_AVAILABLE') return;
      throw error;
    }
    if (!autoRespond || firstOffer === undefined) return;

    // Demostración reproducible: el mejor valorado rechaza y el siguiente acepta.
    await dispatch.respondToOffer(firstOffer.id, 'REJECT', firstOffer.driverId);
    const nextOffer = dispatch.getOffers(ride.id).find(({ status }) => status === 'PENDING');
    if (nextOffer !== undefined) {
      await dispatch.respondToOffer(nextOffer.id, 'ACCEPT', nextOffer.driverId);
    }
  });
};

export const createM5StubDispatch = (
  connection: RabbitMqConnection,
  state: M5StubState,
): M5StubDispatchService =>
  new M5StubDispatchService(state, createM5StubOutcomeHandler(connection));

import type { RabbitMqConnection } from '../../infrastructure/rabbitmq/rabbitmq.connection.js';
import { createEventEnvelope } from '../../messaging/event-envelope.js';
import { IdempotentEventHandler } from '../../messaging/processed-event.repository.js';
import { RabbitMqConsumer } from '../../messaging/rabbitmq-consumer.js';
import { RabbitMqEventPublisher } from '../../messaging/rabbitmq-event-publisher.js';
import {
  readyForDispatchEventSchema,
  RESERVATION_EVENT_TYPES,
  type RideAssignedPayload,
} from '../../messaging/reservation-events.js';
import { createStubRideRequest, type M5StubState } from './app.js';

export const startM5StubMessaging = async (
  connection: RabbitMqConnection,
  state: M5StubState,
  retryLimit: number,
): Promise<void> => {
  const processed = new Set<string>();
  const idempotency = new IdempotentEventHandler({
    hasProcessed: async (eventId) => processed.has(eventId),
    markProcessed: async (eventId) => {
      processed.add(eventId);
    },
  });
  const consumer = new RabbitMqConsumer(connection, retryLimit, idempotency);
  const publisher = new RabbitMqEventPublisher(connection);
  await consumer.start([RESERVATION_EVENT_TYPES.readyForDispatch], async (rawEvent) => {
    const event = readyForDispatchEventSchema.parse(rawEvent);
    const ride = createStubRideRequest(
      state,
      {
        origin: event.payload.route.origin,
        destination: event.payload.route.destination,
        vehicleType: event.payload.vehicleType,
      },
      event.payload.idempotencyKey,
      'ASSIGNED',
    );
    const assigned = createEventEnvelope<RideAssignedPayload>({
      eventType: RESERVATION_EVENT_TYPES.rideAssigned,
      correlationId: event.correlationId,
      aggregateId: event.aggregateId,
      payload: {
        reservationId: event.payload.reservationId,
        requestId: ride.id,
        assignedDriverId: ride.assignedDriverId!,
      },
    });
    await publisher.publish(assigned.eventType, assigned);
  });
};

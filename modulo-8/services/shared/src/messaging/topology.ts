import type { Channel } from 'amqplib';

export const MAIN_EXCHANGE = 'mobility.events';
export const DLX_EXCHANGE = 'mobility.events.dlx';

/**
 * Mapeo canonico entre eventType (PascalCase) y routingKey AMQP.
 * Seccion 4 del Informe Base de Arquitectura AE2 M8.
 */
export const EVENT_TYPE_TO_ROUTING_KEY: Record<string, string> = {
  TripRequested: 'trip.requested',
  TripAssigned: 'trip.assigned',
  DriverArrived: 'trip.driver-arrived',
  TripStarted: 'trip.started',
  TripCancelled: 'trip.cancelled',
  TripCompleted: 'trip.completed',
  PaymentConfirmed: 'payment.confirmed',
  ReceiptIssued: 'receipt.issued',
  NotificationRequested: 'notification.requested',
};

/** Mapeo inverso de routingKey AMQP a eventType. */
export const ROUTING_KEY_TO_EVENT_TYPE: Record<string, string> = Object.entries(
  EVENT_TYPE_TO_ROUTING_KEY
).reduce((acc, [eventType, routingKey]) => {
  acc[routingKey] = eventType;
  return acc;
}, {} as Record<string, string>);

export interface QueueTopologyOptions {
  exchange?: string;
  deadLetterExchange?: string;
  routingKey: string;
  queue: string;
}

export interface QueueTopology {
  exchange: string;
  deadLetterExchange: string;
  routingKey: string;
  queue: string;
  retryQueue: string;
  deadLetterQueue: string;
}

export function buildQueueTopology(options: QueueTopologyOptions): QueueTopology {
  const exchange = options.exchange || MAIN_EXCHANGE;
  const deadLetterExchange = options.deadLetterExchange || DLX_EXCHANGE;
  return {
    exchange,
    deadLetterExchange,
    routingKey: options.routingKey,
    queue: options.queue,
    retryQueue: `${options.queue}.retry`,
    deadLetterQueue: `${options.queue}.dlq`,
  };
}

/** Configura la topologia de colas, exchanges y DLQ en el broker RabbitMQ. */
export async function assertTopology(channel: Channel, topology: QueueTopology): Promise<void> {
  await channel.assertExchange(topology.exchange, 'topic', { durable: true });
  await channel.assertExchange(topology.deadLetterExchange, 'topic', { durable: true });

  await channel.assertQueue(topology.queue, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': topology.deadLetterExchange,
      'x-dead-letter-routing-key': topology.queue,
    },
  });
  await channel.bindQueue(topology.queue, topology.exchange, topology.routingKey);

  await channel.assertQueue(topology.deadLetterQueue, { durable: true });
  await channel.bindQueue(topology.deadLetterQueue, topology.deadLetterExchange, topology.queue);

  await channel.assertQueue(topology.retryQueue, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': topology.queue,
    },
  });
}

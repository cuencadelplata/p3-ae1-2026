import type { Channel } from 'amqplib';

/**
 * Colas de un consumidor segun el catalogo de eventos v1:
 *
 *   exchange (topic) --routingKey--> queue --(rechazo)--> deadLetterExchange --> deadLetterQueue
 *                                     ^  |
 *                                     |  +--(fallo transitorio)--> retryQueue
 *                                     +------(vence la espera)---------+
 *
 * La cola de reintentos no tiene consumidores: el mensaje espera ahi el tiempo
 * de su propiedad expiration y RabbitMQ lo devuelve a la cola principal.
 */
export interface QueueTopology {
  exchange: string;
  deadLetterExchange: string;
  routingKey: string;
  queue: string;
  retryQueue: string;
  deadLetterQueue: string;
}

export function queueTopology(options: {
  exchange: string;
  deadLetterExchange: string;
  routingKey: string;
  queue: string;
}): QueueTopology {
  return {
    ...options,
    retryQueue: `${options.queue}.retry`,
    deadLetterQueue: `${options.queue}.dlq`,
  };
}

export async function assertTopology(channel: Channel, topology: QueueTopology): Promise<void> {
  await channel.assertExchange(topology.exchange, 'topic', { durable: true });
  await channel.assertExchange(topology.deadLetterExchange, 'topic', { durable: true });

  // La clave de descarte es el nombre de la cola, no la del evento: asi cada
  // consumidor recibe en su DLQ solo sus propios mensajes rechazados.
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

  // Al vencer, el mensaje se reenvia por el exchange por defecto a la cola principal.
  await channel.assertQueue(topology.retryQueue, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': topology.queue,
    },
  });
}

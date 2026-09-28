import amqp, { type Channel, type ChannelModel } from 'amqplib';

export const apiUrl = process.env.E2E_API_URL ?? 'http://127.0.0.1:3001';
export const rf6ApiUrl = process.env.RF6_API_URL ?? 'http://127.0.0.1:3000';
export const rabbitMqUrl = process.env.RABBITMQ_URL ?? 'amqp://127.0.0.1:5672';

export async function crearViajeRf6(estado: 'SOLICITADO' | 'CONDUCTOR_EN_CAMINO'): Promise<string> {
  const id = `E2E-${estado}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await fetch(`${rf6ApiUrl}/api/viajes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id,
      clienteId: `cliente-${id}`,
      conductorId: `conductor-${id}`,
      estado,
      origen: 'Calle A',
      destino: 'Calle B',
    }),
  });

  if (!response.ok) {
    throw new Error(`No se pudo crear el viaje RF-6: ${response.status} ${await response.text()}`);
  }
  return id;
}

export async function escucharEvento(routingKey: string): Promise<{
  esperar: () => Promise<Record<string, unknown>>;
  close: () => Promise<void>;
}> {
  const connection = await amqp.connect(rabbitMqUrl);
  const channel = await connection.createChannel();
  await channel.assertExchange('viajes', 'topic', { durable: true });
  const queue = await channel.assertQueue('', { exclusive: true, autoDelete: true });
  await channel.bindQueue(queue.queue, 'viajes', routingKey);

  return {
    esperar: () => esperarMensaje(channel, queue.queue),
    close: async () => {
      await channel.close();
      await connection.close();
    },
  };
}

function esperarMensaje(channel: Channel, queue: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      void channel.cancel(consumerTag).catch(() => undefined);
      reject(new Error(`No se recibió el evento ${queue} dentro del tiempo esperado`));
    }, 5000);
    let consumerTag = '';

    void channel.consume(queue, (message) => {
      if (!message) return;
      clearTimeout(timeout);
      consumerTag = message.fields.consumerTag;
      channel.ack(message);
      resolve(JSON.parse(message.content.toString()) as Record<string, unknown>);
    }).then((result) => {
      consumerTag = result.consumerTag;
    }).catch(reject);
  });
}

export type RabbitMqConnection = ChannelModel;
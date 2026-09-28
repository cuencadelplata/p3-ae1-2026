import amqp from "amqplib";
import type { Channel } from "amqplib";
import { config } from "../config";

export const EXCHANGE_VIAJES = "viajes";        // lo publica M6
export const EXCHANGE_M7 = "m7.eventos";
export const EXCHANGE_DLX = "m7.dlx";
export const QUEUE_CANCELADO = "m7.reintegro.viaje-cancelado";
export const QUEUE_DLQ = "m7.reintegro.viaje-cancelado.dlq";

let canal: Channel | undefined;

export async function iniciarRabbit(): Promise<Channel> {
  const conexion = await amqp.connect(config.rabbitUrl);
  const ch = await conexion.createChannel();

  await ch.assertExchange(EXCHANGE_VIAJES, "topic", { durable: true });
  await ch.assertExchange(EXCHANGE_M7, "topic", { durable: true });
  await ch.assertExchange(EXCHANGE_DLX, "direct", { durable: true });

  await ch.assertQueue(QUEUE_DLQ, { durable: true });
  await ch.bindQueue(QUEUE_DLQ, EXCHANGE_DLX, QUEUE_CANCELADO);

  await ch.assertQueue(QUEUE_CANCELADO, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": EXCHANGE_DLX,
      "x-dead-letter-routing-key": QUEUE_CANCELADO,
    },
  });
  await ch.bindQueue(QUEUE_CANCELADO, EXCHANGE_VIAJES, "viaje.cancelado");

  await ch.prefetch(5);
  canal = ch;
  return ch;
}

export function publicar(routingKey: string, payload: object, messageId: string): void {
  if (!canal) throw new Error("RabbitMQ no inicializado");
  canal.publish(EXCHANGE_M7, routingKey, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    contentType: "application/json",
    messageId,
  });
}
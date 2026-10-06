import amqplib, { type ChannelModel, type Channel } from "amqplib";

const rabbitUrl = process.env.RABBITMQ_URL;

if (!rabbitUrl) {
  throw new Error("Falta RABBITMQ_URL en las variables de entorno");
}

let connection: ChannelModel;
let channel: Channel;

export const EXCHANGE = "m3.eventos";

export async function connectRabbit(): Promise<Channel> {
  connection = await amqplib.connect(rabbitUrl!);
  connection.on("error", (err) => {
    console.error("[rabbitmq] Error de conexión:", err);
  });

  channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE, "topic", { durable: true });

  return channel;
}

export function getChannel(): Channel {
  if (!channel) {
    throw new Error("RabbitMQ todavía no está conectado (falta connectRabbit())");
  }
  return channel;
}
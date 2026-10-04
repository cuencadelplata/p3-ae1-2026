import amqp, { type Channel, type ChannelModel } from "amqplib";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";

export async function getChannel(): Promise<Channel> {
  if (channel) return channel;

  connection = await amqp.connect(RABBITMQ_URL);
  channel = await connection.createChannel();

  // Un exchange tipo "topic" te deja tener varios eventos (routing keys)
  // sin crear un exchange por cada uno.
  await channel.assertExchange("m3-drivers.events", "topic", { durable: true });

  return channel;
}
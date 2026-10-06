import amqp, { type Channel, type ChannelModel } from 'amqplib';
import type { CancellationEventPublisher } from './api.js';

export class RabbitMqEventPublisher implements CancellationEventPublisher {
  private connection?: ChannelModel;
  private channel?: Channel;

  constructor(
    private readonly url: string,
    private readonly exchange = 'viajes',
  ) {}

  async publish(routingKey: string, payload: unknown): Promise<void> {
    const channel = await this.getChannel();
    const message = Buffer.from(JSON.stringify(payload));
    const options = {
      contentType: 'application/json',
      persistent: true,
    };
    if (routingKey === 'despacho.reabrir') {
      channel.sendToQueue(routingKey, message, options);
      return;
    }
    channel.publish(this.exchange, routingKey, message, options);
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  private async getChannel(): Promise<Channel> {
    if (this.channel) return this.channel;
    const connection = await amqp.connect(this.url);
    const channel = await connection.createChannel();
    await channel.assertExchange(this.exchange, 'topic', { durable: true });
    await channel.assertQueue('despacho.reabrir', { durable: true });
    this.connection = connection;
    this.channel = channel;
    return channel;
  }
}
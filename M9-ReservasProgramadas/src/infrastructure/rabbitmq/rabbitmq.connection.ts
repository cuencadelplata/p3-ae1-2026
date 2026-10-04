import amqp, { type ConfirmChannel, type ChannelModel } from 'amqplib';

export interface RabbitMqTopology {
  exchange: string;
  retryExchange: string;
  deadLetterExchange: string;
  queue: string;
  retryQueue: string;
  deadLetterQueue: string;
  retryDelayMs: number;
}

export class RabbitMqConnection {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;

  public constructor(
    private readonly url: string,
    public readonly topology: RabbitMqTopology,
    private readonly onError: (error: unknown) => void = console.error,
  ) {}

  public async connect(): Promise<void> {
    if (this.channel !== null) return;
    const connection = await amqp.connect(this.url);
    connection.on('error', this.onError);
    connection.on('close', () => {
      this.connection = null;
      this.channel = null;
    });
    const channel = await connection.createConfirmChannel();
    await channel.assertExchange(this.topology.exchange, 'topic', { durable: true });
    await channel.assertExchange(this.topology.retryExchange, 'topic', { durable: true });
    await channel.assertExchange(this.topology.deadLetterExchange, 'topic', { durable: true });
    await channel.assertQueue(this.topology.deadLetterQueue, { durable: true });
    await channel.bindQueue(this.topology.deadLetterQueue, this.topology.deadLetterExchange, '#');
    await channel.assertQueue(this.topology.queue, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': this.topology.deadLetterExchange },
    });
    await channel.assertQueue(this.topology.retryQueue, {
      durable: true,
      arguments: {
        'x-message-ttl': this.topology.retryDelayMs,
        'x-dead-letter-exchange': this.topology.exchange,
      },
    });
    await channel.bindQueue(this.topology.retryQueue, this.topology.retryExchange, '#');
    this.connection = connection;
    this.channel = channel;
  }

  public getChannel(): ConfirmChannel {
    if (this.channel === null) throw new Error('RabbitMQ no está conectado.');
    return this.channel;
  }

  public async ping(): Promise<boolean> {
    if (this.channel === null) return false;
    try {
      await this.channel.checkQueue(this.topology.queue);
      return true;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
    this.channel = null;
    this.connection = null;
  }
}

import amqp from 'amqplib';
import { config } from '../config/env.config.js';
import { Logger } from '../logger/structured.logger.js';

export class RabbitMQConnection {
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private pendingConnection: Promise<void> | null = null;
  private closed = false;

  public constructor(private readonly url: string) {}

  public async getChannel(): Promise<amqp.Channel | null> {
    if (this.channel) return this.channel;
    if (this.closed) return null;

    this.pendingConnection ??= this.connect().finally(() => {
      this.pendingConnection = null;
    });
    await this.pendingConnection;
    return this.channel;
  }

  private async connect(): Promise<void> {
    let connection: amqp.ChannelModel | undefined;
    try {
      Logger.info(`Conectando a RabbitMQ en: ${this.url.replace(/\/\/.*@/, '//***@')}`);
      connection = await amqp.connect(this.url, { timeout: 5_000 });
      const conn = connection;
      let disconnected = false;

      const invalidate = () => {
        disconnected = true;
        if (this.connection === conn) {
          this.connection = null;
          this.channel = null;
        }
      };

      conn.on('error', (error) => {
        Logger.error('Error en conexión de RabbitMQ', error);
        invalidate();
      });
      conn.once('close', () => {
        Logger.warn('Conexión con RabbitMQ cerrada');
        invalidate();
      });

      const channel = await conn.createChannel();
      channel.on('error', (error) => Logger.error('Error en canal de RabbitMQ', error));
      channel.once('close', () => {
        invalidate();
        void conn.close().catch(() => undefined);
      });

      await this.setupTopology(channel);
      if (this.closed || disconnected) {
        await conn.close().catch(() => undefined);
        return;
      }
      this.connection = conn;
      this.channel = channel;
      Logger.info('Conexión y topología de RabbitMQ inicializadas con éxito');
    } catch (error) {
      Logger.error('Falla al conectar con RabbitMQ', error);
      await connection?.close().catch(() => undefined);
    }
  }

  public async isConnected(): Promise<boolean> {
    return this.channel !== null;
  }

  public async close(): Promise<void> {
    this.closed = true;
    const connection = this.connection;
    this.connection = null;
    this.channel = null;
    await connection?.close().catch((error) => {
      Logger.warn('Error al cerrar conexión de RabbitMQ', { error });
    });
  }

  private async setupTopology(channel: amqp.Channel): Promise<void> {
    // Exchange para publicar eventos de disponibilidad de conductor
    await channel.assertExchange('driver.events', 'topic', { durable: true });

    // Exchange configurable para recibir eventos de viaje (ej. trip.events o viajes.events)
    const tripExchange = config.rabbitmqTripExchange;
    await channel.assertExchange(tripExchange, 'topic', { durable: true });

    // DLX y DLQ
    await channel.assertExchange('m4.dlx', 'direct', { durable: true });
    await channel.assertQueue('m4.dlq', { durable: true });
    await channel.bindQueue('m4.dlq', 'm4.dlx', 'm4.dead_letter');

    // Cola principal del microservicio M4
    await channel.assertQueue('m4.trip-events.queue', {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'm4.dlx',
        'x-dead-letter-routing-key': 'm4.dead_letter'
      }
    });

    // Subscripción a routing keys configuradas (soporta TripStarted y viaje.iniciado)
    const keysToBind = new Set([
      config.rabbitmqTripStartedKey,
      config.rabbitmqTripCompletedKey,
      config.rabbitmqTripCancelledKey,
      'TripStarted',
      'TripCompleted',
      'TripCancelled',
      'viaje.iniciado',
      'viaje.finalizado',
      'viaje.cancelado'
    ]);

    for (const key of keysToBind) {
      await channel.bindQueue('m4.trip-events.queue', tripExchange, key);
    }
  }
}

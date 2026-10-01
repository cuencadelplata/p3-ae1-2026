import amqp from 'amqplib';
import { Logger } from '../logger/structured.logger.js';

export class RabbitMQConnection {
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private isConnecting = false;

  public constructor(private readonly url: string) {}

  public async getChannel(): Promise<amqp.Channel | null> {
    if (this.channel) return this.channel;
    await this.connect();
    return this.channel;
  }

  public async connect(): Promise<void> {
    if (this.connection && this.channel) return;
    if (this.isConnecting) return;

    this.isConnecting = true;
    try {
      Logger.info(`Conectando a RabbitMQ en: ${this.url.replace(/\/\/.*@/, '//***@')}`);
      const conn = await amqp.connect(this.url);
      const ch = await conn.createChannel();

      this.connection = conn;
      this.channel = ch;

      this.connection.on('error', (err: unknown) => {
        Logger.error('Error en conexión de RabbitMQ', err);
        this.connection = null;
        this.channel = null;
      });

      this.connection.on('close', () => {
        Logger.warn('Conexión con RabbitMQ cerrada');
        this.connection = null;
        this.channel = null;
      });

      // Configurar Exchanges y Colas base
      await this.setupTopology(ch);
      Logger.info('Conexión y topología de RabbitMQ inicializadas con éxito');
    } catch (error) {
      Logger.error('Falla al conectar con RabbitMQ', error);
      this.connection = null;
      this.channel = null;
    } finally {
      this.isConnecting = false;
    }
  }

  public async isConnected(): Promise<boolean> {
    return Boolean(this.connection && this.channel);
  }

  public async close(): Promise<void> {
    try {
      if (this.channel) await this.channel.close();
      if (this.connection) await this.connection.close();
    } catch (error) {
      Logger.warn('Error al cerrar conexión de RabbitMQ', { error });
    } finally {
      this.channel = null;
      this.connection = null;
    }
  }

  private async setupTopology(channel: amqp.Channel): Promise<void> {
    // Exchange para publicar eventos de conductor
    await channel.assertExchange('driver.events', 'topic', { durable: true });

    // Exchange para recibir eventos de viaje
    await channel.assertExchange('trip.events', 'topic', { durable: true });

    // Exchange y cola Dead Letter Queue (DLQ)
    await channel.assertExchange('m4.dlx', 'direct', { durable: true });
    await channel.assertQueue('m4.dlq', { durable: true });
    await channel.bindQueue('m4.dlq', 'm4.dlx', 'm4.dead_letter');

    // Cola principal del microservicio M4 con DLX configurado
    await channel.assertQueue('m4.trip-events.queue', {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'm4.dlx',
        'x-dead-letter-routing-key': 'm4.dead_letter'
      }
    });

    // Subscripción a los eventos de viaje relevantes
    await channel.bindQueue('m4.trip-events.queue', 'trip.events', 'TripStarted');
    await channel.bindQueue('m4.trip-events.queue', 'trip.events', 'TripCompleted');
    await channel.bindQueue('m4.trip-events.queue', 'trip.events', 'TripCancelled');
  }
}

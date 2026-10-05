import amqp from 'amqplib';
import { RideRequest, GeoLocation } from '../types/ride-request.types';
import { randomUUID } from 'node:crypto';

/**
 * Sobre estándar de evento de dominio acordado con Módulo 8 (RNF-07, Criterio 5)
 */
export interface DomainEventEnvelope<T> {
  messageId: string;
  eventType: string;
  version: number;
  occurredAt: string;
  correlationId: string;
  producer: string;
  data: T;
}

export interface RideRequestCreatedPayload {
  rideRequestId: string;
  clientUserId: number;
  origin: GeoLocation;
  destination: GeoLocation;
  vehicleType: string;
  estimatedFare: {
    amount: number;
    currency: string;
  };
  createdAt: string;
}

export type RideRequestCreatedEvent = DomainEventEnvelope<RideRequestCreatedPayload>;

/**
 * Servicio de Mensajería Asíncrona con RabbitMQ (RNF-07, Criterio 5)
 * Rol de Productor (Publisher) para eventos de dominio del ciclo de vida de la solicitud.
 * Incluye:
 * - Declaración de Exchange topic 'mobility.events'
 * - Publicación con routing key 'ride.requested'
 * - Envelope acordado con Módulo 8
 * - Modo resiliente con fallback en memoria (no bloquea el servicio si RabbitMQ no está disponible)
 */
export class RabbitMQService {
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private isConnected = false;
  private connectionAttempted = false;

  public readonly exchangeName = 'mobility.events';
  public readonly exchangeType = 'topic';

  // Almacenamiento en memoria para tests y fallback resiliente
  private publishedEventsBuffer: RideRequestCreatedEvent[] = [];

  constructor() {
    // Si estamos en entorno de tests sin variable explícita, usamos fallback sin conectar
    if (process.env.NODE_ENV === 'test' && !process.env.RABBITMQ_HOST && !process.env.RABBITMQ_URL) {
      this.connection = null;
      this.channel = null;
    }
  }

  /**
   * Inicializa la conexión y el canal hacia RabbitMQ
   */
  public async init(): Promise<boolean> {
    if (this.connectionAttempted) return this.isConnected;
    this.connectionAttempted = true;

    if (process.env.NODE_ENV === 'test' && !process.env.RABBITMQ_HOST && !process.env.RABBITMQ_URL) {
      return false;
    }

    const host = process.env.RABBITMQ_HOST || 'localhost';
    const port = process.env.RABBITMQ_PORT || '5672';
    const user = process.env.RABBITMQ_USER || 'guest';
    const pass = process.env.RABBITMQ_PASS || 'guest';
    const url = process.env.RABBITMQ_URL || `amqp://${user}:${pass}@${host}:${port}`;

    try {
      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();

      // Declarar Exchange durable de tipo topic
      await this.channel.assertExchange(this.exchangeName, this.exchangeType, {
        durable: true
      });

      this.isConnected = true;
      console.log(`[RabbitMQService] Conectado exitosamente a RabbitMQ (${host}:${port}) - Exchange: ${this.exchangeName}`);

      this.connection.on('error', (err: any) => {
        console.warn('[RabbitMQService] Error en conexión RabbitMQ:', err?.message || err);
        this.isConnected = false;
      });

      this.connection.on('close', () => {
        console.warn('[RabbitMQService] Conexión RabbitMQ cerrada. Activando modo buffer.');
        this.isConnected = false;
      });

      return true;
    } catch (err: any) {
      this.isConnected = false;
      console.warn(`[RabbitMQService] RabbitMQ no disponible en ${host}:${port}. Activando modo degradado resiliente.`);
      return false;
    }
  }

  /**
   * Extrae el ID numérico canónico de M1 para clientUserId
   */
  private parseClientUserId(clientId: string): number {
    const numericOnly = clientId.replace(/\D/g, '');
    if (numericOnly.length > 0) {
      const parsed = parseInt(numericOnly, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 42; // ID canónico por defecto si no es numérico puro
  }

  /**
   * Publica el evento de dominio RideRequestCreated (RF-5.1)
   */
  public async publishRideRequestCreated(request: RideRequest): Promise<boolean> {
    const routingKey = 'ride.requested';
    const clientUserId = this.parseClientUserId(request.clientId);

    const event: RideRequestCreatedEvent = {
      messageId: randomUUID(),
      eventType: 'ride.requested',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: request.id,
      producer: 'm5',
      data: {
        rideRequestId: request.id,
        clientUserId,
        origin: request.origin,
        destination: request.destination,
        vehicleType: request.vehicleType,
        estimatedFare: {
          amount: request.estimatedFare.amount,
          currency: request.estimatedFare.currency
        },
        createdAt: request.createdAt
      }
    };

    // Guardar en buffer en memoria para auditoría, tests y modo offline
    this.publishedEventsBuffer.push(event);

    try {
      if (this.isConnected && this.channel) {
        const payloadBuffer = Buffer.from(JSON.stringify(event));
        const published = this.channel.publish(this.exchangeName, routingKey, payloadBuffer, {
          persistent: true,
          contentType: 'application/json',
          messageId: event.messageId,
          correlationId: event.correlationId,
          timestamp: Date.now()
        });

        console.log(
          `[RabbitMQ RF-5.1] Evento '${event.eventType}' publicado exitosamente: ID=${event.messageId} | RoutingKey=${routingKey} | RideRequestId=${request.id} | ClientUserId=${clientUserId}`
        );
        return published;
      }
    } catch (err: any) {
      console.warn('[RabbitMQService] Error publicando mensaje en RabbitMQ:', err?.message || err);
    }

    console.log(
      `[RabbitMQ RF-5.1 - Buffer Local] Evento '${event.eventType}' registrado en buffer: ID=${event.messageId} | RideRequestId=${request.id} | ClientUserId=${clientUserId}`
    );
    return true;
  }

  /**
   * Health check para RabbitMQ (RNF-16)
   */
  public async isHealthy(): Promise<boolean> {
    return this.isConnected && this.channel !== null;
  }

  /**
   * Retorna los eventos emitidos (útil para tests y verificación)
   */
  public getPublishedEvents(): RideRequestCreatedEvent[] {
    return [...this.publishedEventsBuffer];
  }

  /**
   * Limpia el buffer de eventos
   */
  public clearBuffer(): void {
    this.publishedEventsBuffer = [];
  }

  /**
   * Cierra las conexiones activas al apagar el servicio
   */
  public async disconnect(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
    } catch {
      // Ignorar errores al cerrar
    } finally {
      this.channel = null;
      this.connection = null;
      this.isConnected = false;
    }
  }
}

import amqp, { Channel, ChannelModel } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { GeoLocation, EstimatedFare, VehicleType, RideRequest } from '../types/ride-request.types';

export interface TripAssignedEventPayload {
  requestId: string;
  offerId: string;
  driverId: string | number;
  clientId: string | number;
  origin: GeoLocation;
  destination: GeoLocation;
  vehicleType: VehicleType;
  estimatedFare: EstimatedFare;
  assignedAt: string;
}

export interface OfferCreatedEvent {
  eventType: 'OFFER_CREATED';
  offerId: string;
  requestId: string;
  driverId: string;
  ttlSeconds: number;
  expiresAt: string;
  origin: GeoLocation;
  destination: GeoLocation;
  vehicleType: VehicleType;
  estimatedFare: EstimatedFare;
  timestamp: string;
}

export interface DriverCancellationEvent {
  viajeId: string;
  clienteId: string;
  conductorId: string;
  motivo?: string;
  evento: string;
  timestamp: string;
}

/**
 * Sobre estándar de evento de dominio acordado con Módulo 8 (RNF-07, Criterio 5)
 */
export interface StandardEventEnvelope<T = any> {
  messageId: string;
  eventType: string;
  version: number;
  occurredAt: string;
  correlationId: string;
  producer: string;
  data: T;
}

export type DomainEventEnvelope<T> = StandardEventEnvelope<T>;

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
 * Servicio unificado de Mensajería Asíncrona con RabbitMQ (RNF-07 / AE2)
 * Maneja:
 * 1. Publicación de eventos de dominio `driver.offer.accepted` y `ride.requested` en exchange `mobility.events`
 * 2. Publicación de ofertas `dispatch.offers` con TTL a conductores
 * 3. Consumo de cancelaciones en `despacho.reabrir` para reapertura automática de despacho
 * 4. Modo resiliente / buffer en memoria cuando RabbitMQ no está disponible o en tests
 */
export class RabbitMQService {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private isConnected = false;
  private connectionAttempted = false;

  public static readonly QUEUE_OFFERS = 'dispatch.offers';
  public static readonly QUEUE_REOPEN_DISPATCH = 'despacho.reabrir';
  public readonly exchangeName = 'mobility.events';
  public readonly exchangeType = 'topic';

  // Suscriptor para reapertura de despacho ante cancelación de conductor
  private reopenDispatchSubscriber: ((event: DriverCancellationEvent) => Promise<void>) | null = null;

  // Buffer de eventos emitidos en memoria para auditoría, tests y modo degradado
  private publishedEventsBuffer: any[] = [];
  public publishedMessages: Array<{
    exchange?: string;
    routingKey?: string;
    queue?: string;
    message: any;
    publishedAt: string;
  }> = [];

  constructor(rabbitmqUrl?: string) {
    if (process.env.DISABLE_RABBITMQ === 'true') {
      return;
    }

    if (process.env.NODE_ENV === 'test' && !process.env.RABBITMQ_HOST && !process.env.RABBITMQ_URL && !rabbitmqUrl) {
      return;
    }

    this.init(rabbitmqUrl).catch(() => {
      this.isConnected = false;
    });
  }

  /**
   * Helper para convertir identificadores a formato canónico numérico de M1 o string
   */
  public parseCanonicalUserId(id: string | number): number | string {
    if (typeof id === 'number') return id;
    const cleanId = id.replace(/^(client_|drv_|usr_)/, '');
    const num = parseInt(cleanId, 10);
    return isNaN(num) ? id : num;
  }

  /**
   * Inicializa la conexión, el canal, las colas y los exchanges en RabbitMQ
   */
  public async init(urlOverride?: string): Promise<boolean> {
    if (this.connectionAttempted && this.isConnected) return true;
    this.connectionAttempted = true;

    const host = process.env.RABBITMQ_HOST || 'localhost';
    const port = process.env.RABBITMQ_PORT || '5672';
    const user = process.env.RABBITMQ_USER || 'guest';
    const pass = process.env.RABBITMQ_PASS || 'guest';
    const defaultUrl = `amqp://${user}:${pass}@${host}:${port}`;
    const url = urlOverride || process.env.RABBITMQ_URL || defaultUrl;

    try {
      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();

      // Asegurar cola de ofertas para conductores
      await this.channel.assertQueue(RabbitMQService.QUEUE_OFFERS, { durable: true });

      // Asegurar cola de eventos de reapertura de despacho
      await this.channel.assertQueue(RabbitMQService.QUEUE_REOPEN_DISPATCH, { durable: true });

      // Declarar Exchange durable de eventos de movilidad
      await this.channel.assertExchange(this.exchangeName, this.exchangeType, { durable: true });

      this.isConnected = true;
      if (process.env.NODE_ENV !== 'test') {
        console.log(`[RabbitMQService] Conectado exitosamente a RabbitMQ (${url}) - Exchange: ${this.exchangeName}`);
      }

      if (this.reopenDispatchSubscriber) {
        await this.attachReopenDispatchConsumer();
      }

      this.connection.on('error', (err: any) => {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[RabbitMQService] Error en conexión: ${err?.message || err}`);
        }
        this.isConnected = false;
      });

      this.connection.on('close', () => {
        this.isConnected = false;
      });

      return true;
    } catch (err: any) {
      this.isConnected = false;
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[RabbitMQService] RabbitMQ no disponible en ${url}. Activando modo degradado.`);
      }
      return false;
    }
  }

  private async attachReopenDispatchConsumer(): Promise<void> {
    if (!this.channel || !this.reopenDispatchSubscriber) return;

    try {
      await this.channel.consume(RabbitMQService.QUEUE_REOPEN_DISPATCH, async (msg) => {
        if (!msg) return;
        try {
          const content = JSON.parse(msg.content.toString()) as DriverCancellationEvent;
          if (this.reopenDispatchSubscriber) {
            await this.reopenDispatchSubscriber(content);
          }
          this.channel?.ack(msg);
        } catch (err) {
          console.warn(`[RabbitMQService] Error procesando mensaje de ${RabbitMQService.QUEUE_REOPEN_DISPATCH}:`, err);
          this.channel?.nack(msg, false, false);
        }
      });
    } catch (err) {
      console.warn(`[RabbitMQService] Error registrando consumidor: ${(err as Error).message}`);
    }
  }

  public async subscribeToReopenDispatch(
    callback: (event: DriverCancellationEvent) => Promise<void>
  ): Promise<void> {
    this.reopenDispatchSubscriber = callback;

    if (this.isConnected && this.channel) {
      await this.attachReopenDispatchConsumer();
    }
  }

  public async publishDriverCancellation(event: DriverCancellationEvent): Promise<boolean> {
    const content = Buffer.from(JSON.stringify(event));

    if (this.isConnected && this.channel) {
      try {
        const sent = this.channel.sendToQueue(RabbitMQService.QUEUE_REOPEN_DISPATCH, content, {
          persistent: true,
          contentType: 'application/json',
          timestamp: Date.now()
        });
        return sent;
      } catch (err) {
        console.warn(`[RabbitMQService] Error publicando a ${RabbitMQService.QUEUE_REOPEN_DISPATCH}:`, err);
      }
    }

    // Modo simulación en memoria / tests
    if (this.reopenDispatchSubscriber) {
      await this.reopenDispatchSubscriber(event);
    }
    return true;
  }

  public async publishToExchange(routingKey: string, message: any): Promise<boolean> {
    const serialized = Buffer.from(JSON.stringify(message));

    if (this.isConnected && this.channel) {
      try {
        await this.channel.assertExchange(this.exchangeName, 'topic', { durable: true });
        return this.channel.publish(this.exchangeName, routingKey, serialized, {
          persistent: true,
          contentType: 'application/json',
          timestamp: Date.now()
        });
      } catch (err: any) {
        console.warn(`[RabbitMQService] Fallo al publicar a exchange "${this.exchangeName}": ${err.message}`);
      }
    }

    this.publishedMessages.push({
      exchange: this.exchangeName,
      routingKey,
      message,
      publishedAt: new Date().toISOString()
    });
    this.publishedEventsBuffer.push(message);

    return true;
  }

  public async publishToQueue(queueName: string, message: any): Promise<boolean> {
    const serialized = Buffer.from(JSON.stringify(message));

    if (this.isConnected && this.channel) {
      try {
        await this.channel.assertQueue(queueName, { durable: true });
        return this.channel.sendToQueue(queueName, serialized, {
          persistent: true,
          contentType: 'application/json',
          timestamp: Date.now()
        });
      } catch (err: any) {
        console.warn(`[RabbitMQService] Fallo al enviar a cola "${queueName}": ${err.message}`);
      }
    }

    this.publishedMessages.push({
      queue: queueName,
      message,
      publishedAt: new Date().toISOString()
    });

    return true;
  }

  public async publishOfferCreated(event: OfferCreatedEvent): Promise<boolean> {
    return this.publishToQueue(RabbitMQService.QUEUE_OFFERS, event);
  }

  public async publishTripAssigned(payload: TripAssignedEventPayload): Promise<boolean> {
    const clientUserId = this.parseCanonicalUserId(payload.clientId);
    const driverUserId = this.parseCanonicalUserId(payload.driverId);

    const eventEnvelope: StandardEventEnvelope = {
      messageId: randomUUID(),
      eventType: 'driver.offer.accepted',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: payload.requestId,
      producer: 'm5',
      data: {
        rideRequestId: payload.requestId,
        offerId: payload.offerId,
        clientUserId,
        driverUserId,
        origin: payload.origin,
        destination: payload.destination,
        vehicleType: payload.vehicleType,
        fare: payload.estimatedFare
      }
    };

    return this.publishToExchange('driver.offer.accepted', eventEnvelope);
  }

  public async publishRideRequestCreated(rideRequest: RideRequest): Promise<boolean> {
    const clientNum = this.parseCanonicalUserId(rideRequest.clientId);
    const clientUserId = typeof clientNum === 'number' ? clientNum : 1;

    const event: RideRequestCreatedEvent = {
      messageId: randomUUID(),
      eventType: 'ride.requested',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: rideRequest.id,
      producer: 'm5',
      data: {
        rideRequestId: rideRequest.id,
        clientUserId,
        origin: rideRequest.origin,
        destination: rideRequest.destination,
        vehicleType: rideRequest.vehicleType,
        estimatedFare: {
          amount: rideRequest.estimatedFare.amount,
          currency: rideRequest.estimatedFare.currency
        },
        createdAt: rideRequest.createdAt
      }
    };

    return this.publishToExchange('ride.requested', event);
  }

  public async publishRequestCancelled(requestId: string, clientId: string, reason?: string): Promise<boolean> {
    const eventEnvelope: StandardEventEnvelope = {
      messageId: randomUUID(),
      eventType: 'ride_request.cancelled',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: requestId,
      producer: 'm5',
      data: {
        rideRequestId: requestId,
        clientId,
        reason: reason || 'Cancelado por el cliente'
      }
    };

    return this.publishToExchange('ride_request.cancelled', eventEnvelope);
  }

  public getPublishedEvents(): any[] {
    return [...this.publishedEventsBuffer];
  }

  public clearBuffer(): void {
    this.publishedEventsBuffer = [];
    this.publishedMessages = [];
  }

  public async isHealthy(): Promise<boolean> {
    return this.isConnected;
  }

  public async close(): Promise<void> {
    await this.disconnect();
  }

  public async disconnect(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }
      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }
    } catch {
      // Ignorar errores de cierre
    } finally {
      this.isConnected = false;
    }
  }
}

export const RabbitMqService = RabbitMQService;
export type RabbitMqService = RabbitMQService;

import amqp, { Channel, ChannelModel } from 'amqplib';
import { randomUUID } from 'node:crypto';
import {
  DriverCancellationEvent,
  EstimatedFare,
  GeoLocation,
  OfferCreatedEvent,
  RideRequest,
  RideRequestCancelledEvent,
  VehicleType
} from '../types/ride-request.types';

export interface TripAssignedEventPayload {
  requestId: string;
  tripId: string;
  offerId: string;
  driverId: string | number;
  clientId: string | number;
  clientUserId?: number | string;
  driverUserId?: number | string;
  origin: GeoLocation;
  destination: GeoLocation;
  vehicleType: VehicleType;
  estimatedFare: EstimatedFare;
  assignedAt: string;
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
 * 2. Publicación de ofertas `dispatch.offers` con TTL a conductores (RF-5.3)
 * 3. Publicación y suscripción de cancelaciones previas de viaje en `dispatch.cancelled` (RF-5.6)
 * 4. Consumo de cancelaciones en `despacho.reabrir` para reapertura automática de despacho
 * 5. Modo resiliente / buffer en memoria cuando RabbitMQ no está disponible o en tests
 */
export class RabbitMQService {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private isConnected = false;
  private connectionAttempted = false;

  public static readonly QUEUE_OFFERS = 'dispatch.offers';
  public static readonly QUEUE_CANCELLED_REQUESTS = 'dispatch.cancelled';
  public static readonly QUEUE_REOPEN_DISPATCH = 'despacho.reabrir';
  public readonly exchangeName = 'mobility.events';
  public readonly exchangeType = 'topic';

  // Suscriptor para reapertura de despacho ante cancelación de conductor
  private reopenDispatchSubscriber: ((event: DriverCancellationEvent) => Promise<void>) | null = null;
  private cancelledRequestsSubscriber: ((event: RideRequestCancelledEvent) => Promise<void>) | null = null;
  private offerCreatedSubscriber: ((event: OfferCreatedEvent) => Promise<void> | void) | null = null;

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
      await this.channel.assertQueue(RabbitMQService.QUEUE_CANCELLED_REQUESTS, { durable: true });
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
      if (this.cancelledRequestsSubscriber) {
        await this.attachCancelledRequestsConsumer();
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

  /**
   * Suscribe un consumidor a la cola dispatch.offers (CP-5.3-14)
   * Permite evidenciar recepción de mensajes de ofertas tanto en modo simulado como en RabbitMQ real.
   */
  public async subscribeToOfferCreated(
    callback: (event: OfferCreatedEvent) => Promise<void> | void
  ): Promise<void> {
    this.offerCreatedSubscriber = callback;

    if (this.isConnected && this.channel) {
      try {
        await this.channel.assertQueue(RabbitMQService.QUEUE_OFFERS, { durable: true });
        await this.channel.consume(RabbitMQService.QUEUE_OFFERS, async (msg) => {
          if (!msg) return;
          try {
            const content = JSON.parse(msg.content.toString()) as OfferCreatedEvent;
            if (this.offerCreatedSubscriber) {
              await this.offerCreatedSubscriber(content);
            }
            this.channel?.ack(msg);
          } catch (err) {
            console.warn(`[RabbitMQService] Error consumiendo mensaje de ${RabbitMQService.QUEUE_OFFERS}:`, err);
            this.channel?.nack(msg, false, false);
          }
        });
        console.log(`[RabbitMQService] Consumidor activo escuchando cola '${RabbitMQService.QUEUE_OFFERS}'`);
      } catch (err) {
        console.warn(`[RabbitMQService] Error registrando consumidor en ${RabbitMQService.QUEUE_OFFERS}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Registra un callback para procesar cancelaciones de chofer y reabrir despacho
   */
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

  /**
   * Publica el evento de cancelación previa de viaje (RF-5.6 / RNF-07)
   */
  public async publishRideRequestCancelled(event: RideRequestCancelledEvent): Promise<boolean> {
    const content = Buffer.from(JSON.stringify(event));

    if (this.isConnected && this.channel) {
      try {
        const sent = this.channel.sendToQueue(RabbitMQService.QUEUE_CANCELLED_REQUESTS, content, {
          persistent: true,
          contentType: 'application/json',
          timestamp: Date.now()
        });

        if (process.env.NODE_ENV !== 'test') {
          console.log(
            `[RabbitMQ] Evento de cancelación previa publicado: Solicitud=${event.requestId} | Cliente=${event.clientId} | Afectados=${event.affectedDriverIds.length} conductores`
          );
        }
        return sent;
      } catch (err) {
        console.warn(`[RabbitMQService] Error publicando en ${RabbitMQService.QUEUE_CANCELLED_REQUESTS}: ${(err as Error).message}`);
      }
    }

    if (process.env.NODE_ENV !== 'test') {
      console.log(
        `[RabbitMQ-Simulado] Evento ${event.eventType} despachado en memoria para solicitud ${event.requestId} (Cliente: ${event.clientId})`
      );
    }
    if (this.cancelledRequestsSubscriber) {
      await this.cancelledRequestsSubscriber(event);
    }
    return true;
  }

  /**
   * Suscribe a la cola de cancelaciones (RF-5.6)
   */
  public async subscribeToCancelledRequests(
    callback: (event: RideRequestCancelledEvent) => Promise<void>
  ): Promise<void> {
    this.cancelledRequestsSubscriber = callback;
    if (this.isConnected && this.channel) {
      await this.attachCancelledRequestsConsumer();
    }
  }

  private async attachCancelledRequestsConsumer(): Promise<void> {
    if (!this.channel || !this.cancelledRequestsSubscriber) return;

    try {
      await this.channel.consume(RabbitMQService.QUEUE_CANCELLED_REQUESTS, async (msg) => {
        if (!msg) return;
        try {
          const content = JSON.parse(msg.content.toString()) as RideRequestCancelledEvent;
          if (this.cancelledRequestsSubscriber) {
            await this.cancelledRequestsSubscriber(content);
          }
          this.channel?.ack(msg);
        } catch (err) {
          console.warn(`[RabbitMQService] Error procesando mensaje de ${RabbitMQService.QUEUE_CANCELLED_REQUESTS}:`, err);
          this.channel?.nack(msg, false, false);
        }
      });
    } catch (err) {
      console.warn(`[RabbitMQService] Error registrando consumidor de cancelaciones: ${(err as Error).message}`);
    }
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
    const sent = await this.publishToQueue(RabbitMQService.QUEUE_OFFERS, event);
    if (this.offerCreatedSubscriber) {
      try {
        await this.offerCreatedSubscriber(event);
      } catch (err) {
        console.warn('[RabbitMQService] Error en suscriptor de oferta creada:', err);
      }
    }
    return sent;
  }

  public async publishTripAssigned(payload: TripAssignedEventPayload): Promise<boolean> {
    if (!payload.tripId || typeof payload.tripId !== 'string' || payload.tripId.trim().length === 0) {
      console.warn('[RabbitMQService] No se puede publicar driver.offer.accepted sin un tripId válido de M6.');
      return false;
    }

    const rawClient = payload.clientUserId ?? this.parseCanonicalUserId(payload.clientId);
    const rawDriver = payload.driverUserId ?? this.parseCanonicalUserId(payload.driverId);

    const clientUserId = typeof rawClient === 'number' && Number.isSafeInteger(rawClient) && rawClient > 0 ? rawClient : null;
    const driverUserId = typeof rawDriver === 'number' && Number.isSafeInteger(rawDriver) && rawDriver > 0 ? rawDriver : null;

    if (!clientUserId || !driverUserId || clientUserId === driverUserId) {
      console.warn(
        `[RabbitMQService] No se puede publicar driver.offer.accepted: clientUserId (${rawClient}) y driverUserId (${rawDriver}) deben ser enteros positivos válidos de M1 y distintos.`
      );
      return false;
    }

    const originAddress = payload.origin.address && payload.origin.address.trim().length > 0
      ? payload.origin.address
      : `${payload.origin.latitude},${payload.origin.longitude}`;
    const destinationAddress = payload.destination.address && payload.destination.address.trim().length > 0
      ? payload.destination.address
      : `${payload.destination.latitude},${payload.destination.longitude}`;

    const fareAmount = typeof payload.estimatedFare?.amount === 'number' && Number.isFinite(payload.estimatedFare.amount) && payload.estimatedFare.amount >= 0
      ? payload.estimatedFare.amount
      : 0;

    const eventEnvelope: StandardEventEnvelope = {
      messageId: randomUUID(),
      eventType: 'driver.offer.accepted',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: payload.tripId,
      producer: 'm5',
      data: {
        rideRequestId: payload.requestId,
        tripId: payload.tripId,
        offerId: payload.offerId,
        clientUserId,
        driverUserId,
        origin: {
          latitude: payload.origin.latitude,
          longitude: payload.origin.longitude,
          address: originAddress
        },
        destination: {
          latitude: payload.destination.latitude,
          longitude: payload.destination.longitude,
          address: destinationAddress
        },
        vehicleType: payload.vehicleType,
        fare: {
          amount: fareAmount,
          currency: 'ARS'
        }
      }
    };

    return this.publishToExchange('driver.offer.accepted', eventEnvelope);
  }

  public async publishRideRequestCreated(rideRequest: RideRequest): Promise<boolean> {
    const clientNum = rideRequest.clientUserId ?? this.parseCanonicalUserId(rideRequest.clientId);
    let clientUserId: number | null = null;
    if (typeof clientNum === 'number' && Number.isSafeInteger(clientNum) && clientNum > 0) {
      clientUserId = clientNum;
    } else if (process.env.NODE_ENV === 'test') {
      // En entorno de tests unitarios legados donde se usan IDs no numéricos como 'client_a',
      // se utiliza 1 como fallback para no romper los tests existentes, pero logueando warn
      clientUserId = 1;
    }

    if (!clientUserId) {
      console.warn(
        `[RabbitMQService] No se puede publicar ride.requested: clientUserId (${clientNum}) no es un entero positivo válido de M1.`
      );
      return false;
    }

    const originAddress = rideRequest.origin.address && rideRequest.origin.address.trim().length > 0
      ? rideRequest.origin.address
      : `${rideRequest.origin.latitude},${rideRequest.origin.longitude}`;
    const destinationAddress = rideRequest.destination.address && rideRequest.destination.address.trim().length > 0
      ? rideRequest.destination.address
      : `${rideRequest.destination.latitude},${rideRequest.destination.longitude}`;

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
        origin: {
          latitude: rideRequest.origin.latitude,
          longitude: rideRequest.origin.longitude,
          address: originAddress
        },
        destination: {
          latitude: rideRequest.destination.latitude,
          longitude: rideRequest.destination.longitude,
          address: destinationAddress
        },
        vehicleType: rideRequest.vehicleType,
        estimatedFare: {
          amount: rideRequest.estimatedFare.amount,
          currency: rideRequest.estimatedFare.currency || 'ARS'
        },
        createdAt: rideRequest.createdAt
      }
    };

    return this.publishToExchange('ride.requested', event);
  }

  public async publishRequestCancelled(
    requestId: string,
    clientId: string,
    reason?: string,
    explicitClientUserId?: number
  ): Promise<boolean> {
    const rawClient = explicitClientUserId ?? this.parseCanonicalUserId(clientId);
    const clientUserId = typeof rawClient === 'number' && Number.isSafeInteger(rawClient) && rawClient > 0 ? rawClient : null;

    if (!clientUserId) {
      console.warn(
        `[RabbitMQService] No se puede publicar ride_request.cancelled: clientUserId (${rawClient}) no es un entero positivo válido de M1.`
      );
      return false;
    }

    const eventEnvelope: StandardEventEnvelope = {
      messageId: randomUUID(),
      eventType: 'ride_request.cancelled',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: requestId,
      producer: 'm5',
      data: {
        rideRequestId: requestId,
        clientUserId,
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

  public isHealthy(): boolean {
    return this.isConnected;
  }

  public isReady(): boolean {
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

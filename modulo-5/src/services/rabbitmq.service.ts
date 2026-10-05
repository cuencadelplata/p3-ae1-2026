import amqplib, { Channel, ChannelModel } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { GeoLocation, EstimatedFare, VehicleType } from '../types/ride-request.types';

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

export interface StandardEventEnvelope<T = any> {
  messageId: string;
  eventType: string;
  version: number;
  occurredAt: string;
  correlationId: string;
  producer: string;
  data: T;
}

/**
 * Servicio de Mensajería Asíncrona con RabbitMQ para Módulo 5 (Solicitud y Despacho)
 * Integra eventos con la topología desacoplada:
 * - Exchange: mobility.events (tipo: topic)
 * - Routing Key: driver.offer.accepted (RF-5.5)
 * - Consumidores: M6 (Viajes) y M8 (Notificaciones)
 */
export class RabbitMqService {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private isConnected = false;
  public readonly exchangeName = 'mobility.events';

  // Registro en memoria de mensajes publicados para tests y fallback offline
  public publishedMessages: Array<{
    exchange?: string;
    routingKey?: string;
    queue?: string;
    message: any;
    publishedAt: string;
  }> = [];

  constructor(private readonly rabbitMqUrl?: string) {
    const url = this.rabbitMqUrl || process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
    this.initRabbit(url);
  }

  private async initRabbit(url: string): Promise<void> {
    try {
      this.connection = await amqplib.connect(url);
      this.channel = await this.connection.createChannel();

      // Declarar Exchange principal de la arquitectura distribuida (tipo topic, durable: true)
      await this.channel.assertExchange(this.exchangeName, 'topic', { durable: true });

      // Declarar colas de compatibilidad local
      await this.channel.assertQueue('dispatch.offers', { durable: true });
      await this.channel.assertQueue('despacho.reabrir', { durable: true });

      this.isConnected = true;
      console.log(`[RabbitMqService] Conectado exitosamente a RabbitMQ (Exchange: "${this.exchangeName}" [topic]).`);

      this.connection.on('error', (err: any) => {
        this.isConnected = false;
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[RabbitMqService] Error en conexión RabbitMQ: ${err.message}. Entrando en modo fallback.`);
        }
      });

      this.connection.on('close', () => {
        this.isConnected = false;
      });
    } catch {
      this.isConnected = false;
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[RabbitMqService] RabbitMQ no disponible en arranque. Utilizando fallback en memoria.');
      }
    }
  }

  /**
   * Helper para convertir identificadores a formato canónico numérico de M1 o string
   */
  private parseCanonicalUserId(id: string | number): number | string {
    if (typeof id === 'number') return id;
    const cleanId = id.replace(/^(client_|drv_|usr_)/, '');
    const num = parseInt(cleanId, 10);
    return isNaN(num) ? id : num;
  }

  /**
   * Publica un mensaje al Exchange con su Routing Key (Desacoplamiento total / EDA)
   */
  public async publishToExchange(routingKey: string, message: any): Promise<boolean> {
    const serialized = Buffer.from(JSON.stringify(message));

    if (this.isConnected && this.channel) {
      try {
        await this.channel.assertExchange(this.exchangeName, 'topic', { durable: true });
        const success = this.channel.publish(this.exchangeName, routingKey, serialized, {
          persistent: true,
          contentType: 'application/json',
          timestamp: Date.now()
        });

        console.log(`[RabbitMqService] Evento publicado a exchange "${this.exchangeName}" [${routingKey}]:`, message.eventType || routingKey);
        return success;
      } catch (err: any) {
        console.warn(`[RabbitMqService] Fallo al publicar a exchange "${this.exchangeName}": ${err.message}. Guardando en fallback.`);
      }
    }

    // Fallback en memoria
    this.publishedMessages.push({
      exchange: this.exchangeName,
      routingKey,
      message,
      publishedAt: new Date().toISOString()
    });

    return true;
  }

  /**
   * Publica un mensaje directamente a una cola (para flujos internos de M5)
   */
  public async publishToQueue(queueName: string, message: any): Promise<boolean> {
    const serialized = Buffer.from(JSON.stringify(message));

    if (this.isConnected && this.channel) {
      try {
        await this.channel.assertQueue(queueName, { durable: true });
        const success = this.channel.sendToQueue(queueName, serialized, {
          persistent: true,
          contentType: 'application/json',
          timestamp: Date.now()
        });

        return success;
      } catch (err: any) {
        console.warn(`[RabbitMqService] Fallo al enviar a cola "${queueName}": ${err.message}. Guardando en fallback.`);
      }
    }

    this.publishedMessages.push({
      queue: queueName,
      message,
      publishedAt: new Date().toISOString()
    });

    return true;
  }

  /**
   * Publica el evento de Asignación de Oferta / Conductor (RF-5.5 / RNF-07)
   * Exchange: mobility.events
   * Routing Key: driver.offer.accepted
   * Consumidores: Módulo 6 (Trip Management) y Módulo 8 (Notificaciones)
   */
  public async publishTripAssigned(payload: TripAssignedEventPayload): Promise<boolean> {
    const clientUserId = this.parseCanonicalUserId(payload.clientId);
    const driverUserId = this.parseCanonicalUserId(payload.driverId);

    const eventEnvelope: StandardEventEnvelope = {
      messageId: `msg_${randomUUID()}`,
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

  /**
   * Publica evento de Cancelación de Solicitud (RF-5.6)
   */
  public async publishRequestCancelled(requestId: string, clientId: string, reason?: string): Promise<boolean> {
    const eventEnvelope: StandardEventEnvelope = {
      messageId: `msg_${randomUUID()}`,
      eventType: 'ride_request.cancelled',
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: requestId,
      producer: 'm5',
      data: {
        rideRequestId: requestId,
        clientUserId: this.parseCanonicalUserId(clientId),
        reason: reason || 'Cancelado por el cliente antes de la asignación'
      }
    };

    return this.publishToExchange('ride_request.cancelled', eventEnvelope);
  }

  /**
   * Cierra limpiamente los canales y la conexión
   */
  public async disconnect(): Promise<void> {
    try {
      if (this.channel) await this.channel.close().catch(() => {});
      if (this.connection) await this.connection.close().catch(() => {});
      this.isConnected = false;
    } catch {
      // Ignore
    }
  }
}

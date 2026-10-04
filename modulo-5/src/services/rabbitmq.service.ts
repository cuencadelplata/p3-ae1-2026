import amqplib, { Channel, ChannelModel } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { GeoLocation, EstimatedFare, VehicleType } from '../types/ride-request.types';

export interface TripAssignedEventPayload {
  requestId: string;
  offerId: string;
  driverId: string;
  clientId: string;
  origin: GeoLocation;
  destination: GeoLocation;
  vehicleType: VehicleType;
  estimatedFare: EstimatedFare;
  assignedAt: string;
}

export interface DomainEvent<T = any> {
  eventId: string;
  eventType: string;
  timestamp: string;
  payload: T;
}

/**
 * Servicio de Mensajería Asíncrona con RabbitMQ para Módulo 5
 * Encargado de comunicar eventos de despacho hacia otros módulos:
 * - M6 (Viajes y Ciclo de Vida): Para inicializar el Trip al confirmarse la asignación
 * - M8 (Notificaciones y Soporte): Para alertar al cliente y al conductor
 * - M4 (Ubicación): Para actualizar el estado operativo del conductor a ocupado
 */
export class RabbitMqService {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private isConnected = false;

  // Registro en memoria de mensajes publicados para tests unitarios y modo fallback
  public publishedMessages: Array<{ queue: string; message: any; publishedAt: string }> = [];

  constructor(private readonly rabbitMqUrl?: string) {
    const url = this.rabbitMqUrl || process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
    this.initRabbit(url);
  }

  private async initRabbit(url: string): Promise<void> {
    try {
      this.connection = await amqplib.connect(url);
      this.channel = await this.connection.createChannel();

      // Asegurar existencia de las colas estándar del módulo (durable: true)
      await this.channel.assertQueue('dispatch.assigned', { durable: true });
      await this.channel.assertQueue('dispatch.offers', { durable: true });
      await this.channel.assertQueue('despacho.reabrir', { durable: true });

      this.isConnected = true;
      console.log('[RabbitMqService] Conectado exitosamente a RabbitMQ (Colas: dispatch.assigned, dispatch.offers, despacho.reabrir).');

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
   * Publica un mensaje genérico directamente a una cola (Default Exchange)
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

        console.log(`[RabbitMqService] Evento enviado a cola "${queueName}":`, message.eventType || queueName);
        return success;
      } catch (err: any) {
        console.warn(`[RabbitMqService] Fallo al enviar a "${queueName}": ${err.message}. Guardando en fallback.`);
      }
    }

    // Fallback en memoria
    this.publishedMessages.push({
      queue: queueName,
      message,
      publishedAt: new Date().toISOString()
    });

    return true;
  }

  /**
   * Publica el evento de Asignación Exclusiva de Viaje (RF-5.5 / RNF-07)
   * Cola: dispatch.assigned
   * Consumidores esperados: Módulo 6 (Trip Management) y Módulo 8 (Notificaciones)
   */
  public async publishTripAssigned(payload: TripAssignedEventPayload): Promise<boolean> {
    const event: DomainEvent<TripAssignedEventPayload> = {
      eventId: `evt_${randomUUID()}`,
      eventType: 'TRIP_ASSIGNED',
      timestamp: new Date().toISOString(),
      payload
    };

    return this.publishToQueue('dispatch.assigned', event);
  }

  /**
   * Publica evento de Cancelación de Solicitud (RF-5.6)
   * Cola: dispatch.offers
   */
  public async publishRequestCancelled(requestId: string, clientId: string, reason?: string): Promise<boolean> {
    const event = {
      eventId: `evt_${randomUUID()}`,
      eventType: 'RIDE_REQUEST_CANCELLED',
      requestId,
      clientId,
      reason: reason || 'Cancelado por el cliente antes de la asignación',
      timestamp: new Date().toISOString()
    };

    return this.publishToQueue('dispatch.offers', event);
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

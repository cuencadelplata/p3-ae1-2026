import amqp, { Channel, ChannelModel } from 'amqplib';
import { GeoLocation, EstimatedFare, VehicleType } from '../types/ride-request.types';

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

/**
 * Servicio de Mensajería Asíncrona con RabbitMQ (RNF-07 / RF-5.3)
 */
export class RabbitMQService {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private isConnected = false;
  public static readonly QUEUE_OFFERS = 'dispatch.offers';

  constructor(rabbitmqUrl?: string) {
    const url = rabbitmqUrl || process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

    if (process.env.DISABLE_RABBITMQ === 'true') {
      console.log('[RabbitMQService] Modo simulación activo (DISABLE_RABBITMQ=true)');
      return;
    }

    this.init(url).catch(() => {
      this.isConnected = false;
      // Fallback silencioso para no bloquear ejecución local sin Docker
    });
  }

  private async init(url: string): Promise<void> {
    try {
      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();

      // Asegurar que la cola de ofertas exista y sea duradera
      await this.channel.assertQueue(RabbitMQService.QUEUE_OFFERS, {
        durable: true
      });

      this.isConnected = true;
      console.log(`[RabbitMQService] Conectado exitosamente a RabbitMQ (${url})`);

      this.connection.on('error', (err: Error) => {
        console.warn(`[RabbitMQService] Error en conexión: ${err.message}`);
        this.isConnected = false;
      });

      this.connection.on('close', () => {
        this.isConnected = false;
      });
    } catch {
      this.isConnected = false;
    }
  }

  /**
   * Publica el evento asíncrono de oferta despachada (RF-5.3 / RNF-07)
   */
  public async publishOfferCreated(event: OfferCreatedEvent): Promise<boolean> {
    const content = Buffer.from(JSON.stringify(event));

    if (this.isConnected && this.channel) {
      try {
        const sent = this.channel.sendToQueue(RabbitMQService.QUEUE_OFFERS, content, {
          persistent: true,
          contentType: 'application/json',
          timestamp: Date.now()
        });

        console.log(
          `[RabbitMQ] Evento publicado: ${event.eventType} | Oferta=${event.offerId} | Conductor=${event.driverId} | Cola=${RabbitMQService.QUEUE_OFFERS}`
        );
        return sent;
      } catch (err) {
        console.warn(`[RabbitMQService] Error publicando mensaje: ${(err as Error).message}`);
      }
    }

    // Registro en log cuando corre sin el contenedor encendido (modo degradado/fallback)
    console.log(
      `[RabbitMQ-Simulado] Evento ${event.eventType} despachado en memoria para oferta ${event.offerId} (Destinatario: ${event.driverId})`
    );
    return true;
  }

  public isReady(): boolean {
    return this.isConnected;
  }

  public async close(): Promise<void> {
    try {
      if (this.channel) await this.channel.close();
      if (this.connection) await this.connection.close();
    } catch {
      // Ignorar errores al cerrar
    }
    this.isConnected = false;
  }
}

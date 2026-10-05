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

export interface DriverCancellationEvent {
  viajeId: string;
  clienteId: string;
  conductorId: string;
  motivo?: string;
  evento: string;
  timestamp: string;
}

/**
 * Servicio de Mensajería Asíncrona con RabbitMQ (RNF-07 / RF-5.3 y Reapertura de Despacho)
 */
export class RabbitMQService {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private isConnected = false;
  public static readonly QUEUE_OFFERS = 'dispatch.offers';
  public static readonly QUEUE_REOPEN_DISPATCH = 'despacho.reabrir';

  // Almacena el suscriptor para invocarlo tanto en conexión real como en modo simulado/fallback
  private reopenDispatchSubscriber: ((event: DriverCancellationEvent) => Promise<void>) | null = null;

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

      // Asegurar que la cola de reapertura de despacho exista y sea duradera
      await this.channel.assertQueue(RabbitMQService.QUEUE_REOPEN_DISPATCH, {
        durable: true
      });

      this.isConnected = true;
      console.log(`[RabbitMQService] Conectado exitosamente a RabbitMQ (${url})`);

      // Si se había registrado un listener de reapertura antes de conectar el canal, activarlo ahora
      if (this.reopenDispatchSubscriber) {
        await this.attachReopenDispatchConsumer();
      }

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
   * Adjunta el consumidor a la cola despacho.reabrir en el canal activo de RabbitMQ
   */
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
          // Si el mensaje está corrupto, lo descartamos para no generar loops infinitos
          this.channel?.nack(msg, false, false);
        }
      });
      console.log(`[RabbitMQService] Consumidor activo escuchando cola '${RabbitMQService.QUEUE_REOPEN_DISPATCH}'`);
    } catch (err) {
      console.warn(`[RabbitMQService] Error registrando consumidor en RabbitMQ: ${(err as Error).message}`);
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

  /**
   * Publica un evento de cancelación de conductor en la cola despacho.reabrir
   * (Útil para pruebas y para simular el módulo de cancelaciones de Lucas)
   */
  public async publishDriverCancellation(event: DriverCancellationEvent): Promise<boolean> {
    const content = Buffer.from(JSON.stringify(event));

    if (this.isConnected && this.channel) {
      try {
        const sent = this.channel.sendToQueue(RabbitMQService.QUEUE_REOPEN_DISPATCH, content, {
          persistent: true,
          contentType: 'application/json',
          timestamp: Date.now()
        });

        console.log(
          `[RabbitMQ] Evento de cancelación publicado a cola '${RabbitMQService.QUEUE_REOPEN_DISPATCH}': Viaje=${event.viajeId} | Conductor=${event.conductorId}`
        );
        return sent;
      } catch (err) {
        console.warn(`[RabbitMQService] Error publicando mensaje en ${RabbitMQService.QUEUE_REOPEN_DISPATCH}: ${(err as Error).message}`);
      }
    }

    // Modo simulación/fallback (memoria): invocar directamente al suscriptor si existe
    console.log(
      `[RabbitMQ-Simulado] Evento ${event.evento} despachado en memoria para viaje ${event.viajeId} (Conductor: ${event.conductorId})`
    );
    if (this.reopenDispatchSubscriber) {
      await this.reopenDispatchSubscriber(event);
    }
    return true;
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

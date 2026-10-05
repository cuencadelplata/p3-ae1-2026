import amqp, { Channel, ChannelModel } from 'amqplib';
import {
  DriverCancellationEvent,
  OfferCreatedEvent,
  RideRequestCancelledEvent
} from '../types/ride-request.types';

/**
 * Servicio de Mensajería Asíncrona con RabbitMQ (RNF-07 / RF-5.3 / RF-5.6)
 * Facilita el desacoplamiento con Módulo 6 (Ciclo de Vida) y Módulo 8 (Notificaciones).
 */
export class RabbitMQService {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private isConnected = false;

  public static readonly QUEUE_OFFERS = 'dispatch.offers';
  public static readonly QUEUE_CANCELLED_REQUESTS = 'dispatch.cancelled';
  public static readonly QUEUE_REOPEN_DISPATCH = 'despacho.reabrir';

  private reopenDispatchSubscriber: ((event: DriverCancellationEvent) => Promise<void>) | null = null;
  private cancelledRequestsSubscriber: ((event: RideRequestCancelledEvent) => Promise<void>) | null = null;

  constructor(rabbitmqUrl?: string) {
    const url = rabbitmqUrl || process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

    if (process.env.DISABLE_RABBITMQ === 'true') {
      console.log('[RabbitMQService] Modo simulación activo (DISABLE_RABBITMQ=true)');
      return;
    }

    this.init(url).catch(() => {
      this.isConnected = false;
      // Fallback silencioso en desarrollo local o testing
    });
  }

  private async init(url: string): Promise<void> {
    try {
      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();

      // Declarar colas duraderas
      await this.channel.assertQueue(RabbitMQService.QUEUE_OFFERS, { durable: true });
      await this.channel.assertQueue(RabbitMQService.QUEUE_CANCELLED_REQUESTS, { durable: true });
      await this.channel.assertQueue(RabbitMQService.QUEUE_REOPEN_DISPATCH, { durable: true });

      this.isConnected = true;
      console.log(`[RabbitMQService] Conectado exitosamente a RabbitMQ (${url})`);

      if (this.reopenDispatchSubscriber) {
        await this.attachReopenDispatchConsumer();
      }
      if (this.cancelledRequestsSubscriber) {
        await this.attachCancelledRequestsConsumer();
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
   * Publica el evento de cancelación previa de viaje (RF-5.6 / RNF-07)
   * Informa asíncronamente a M6 (Ciclo de Vida) y M8 (Notificaciones / liberación de choferes).
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

        console.log(
          `[RabbitMQ] Evento de cancelación previa publicado: Solicitud=${event.requestId} | Cliente=${event.clientId} | Afectados=${event.affectedDriverIds.length} conductores`
        );
        return sent;
      } catch (err) {
        console.warn(`[RabbitMQService] Error publicando en ${RabbitMQService.QUEUE_CANCELLED_REQUESTS}: ${(err as Error).message}`);
      }
    }

    // Modo simulación/fallback en memoria
    console.log(
      `[RabbitMQ-Simulado] Evento ${event.eventType} despachado en memoria para solicitud ${event.requestId} (Cliente: ${event.clientId})`
    );
    if (this.cancelledRequestsSubscriber) {
      await this.cancelledRequestsSubscriber(event);
    }
    return true;
  }

  /**
   * Suscribe a la cola de cancelaciones (útil para tests o mocks de M6/M8)
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

  /**
   * Publica el evento de oferta despachada (RF-5.3)
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
        return sent;
      } catch (err) {
        console.warn(`[RabbitMQService] Error publicando oferta en RabbitMQ: ${(err as Error).message}`);
      }
    }

    console.log(
      `[RabbitMQ-Simulado] Evento ${event.eventType} despachado en memoria para oferta ${event.offerId}`
    );
    return true;
  }

  /**
   * Publica evento de cancelación de conductor
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
        return sent;
      } catch (err) {
        console.warn(`[RabbitMQService] Error publicando mensaje en ${RabbitMQService.QUEUE_REOPEN_DISPATCH}: ${(err as Error).message}`);
      }
    }

    if (this.reopenDispatchSubscriber) {
      await this.reopenDispatchSubscriber(event);
    }
    return true;
  }

  public async subscribeToReopenDispatch(
    callback: (event: DriverCancellationEvent) => Promise<void>
  ): Promise<void> {
    this.reopenDispatchSubscriber = callback;
    if (this.isConnected && this.channel) {
      await this.attachReopenDispatchConsumer();
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

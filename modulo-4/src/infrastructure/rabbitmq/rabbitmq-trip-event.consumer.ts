import type amqp from 'amqplib';
import type { TripEvent } from '../../domain/entities/location.entity.js';
import type { EventStore } from '../../ports/event-store.port.js';
import type { TripEventHandler } from '../../application/event-handlers/trip-event.handler.js';
import { Logger } from '../logger/structured.logger.js';
import type { RabbitMQConnection } from './rabbitmq.connection.js';

export class RabbitMQTripEventConsumer {
  private readonly maxRetries = 3;
  private subscribedChannel: amqp.Channel | null = null;
  private running = false;
  private retryTimer?: ReturnType<typeof setTimeout>;

  public constructor(
    private readonly connectionManager: RabbitMQConnection,
    private readonly tripEventHandler: TripEventHandler,
    private readonly eventStore: EventStore
  ) {}

  public startConsuming(): void {
    if (this.running) return;
    this.running = true;
    void this.ensureSubscription();
  }

  public stopConsuming(): void {
    this.running = false;
    clearTimeout(this.retryTimer);
  }

  private async ensureSubscription(): Promise<void> {
    try {
      const channel = await this.connectionManager.getChannel();
      if (!this.running || !channel || this.subscribedChannel === channel) return;

      const queueName = 'm4.trip-events.queue';
      await channel.prefetch(1);
      if (!this.running) return;

      this.subscribedChannel = channel;
      await channel.consume(
        queueName,
        async (msg) => {
          if (!msg) {
            if (this.subscribedChannel === channel) this.subscribedChannel = null;
            return;
          }

          try {
            await this.processMessage(channel, msg);
          } catch (error) {
            Logger.error('Error no capturado en el consumidor de eventos de viaje', error);
            channel.nack(msg, false, false);
          }
        },
        { noAck: false }
      );
      Logger.info(`Consumiendo cola RabbitMQ '${queueName}'`);
    } catch (error) {
      this.subscribedChannel = null;
      Logger.error('Falla al iniciar el consumidor RabbitMQ', error);
    } finally {
      if (this.running) {
        this.retryTimer = setTimeout(() => void this.ensureSubscription(), 1_000);
      }
    }
  }

  public async processMessage(channel: amqp.Channel, msg: amqp.ConsumeMessage): Promise<void> {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(msg.content.toString('utf8'));
    } catch (parseError) {
      Logger.error('Error de formato JSON en mensaje recibido de RabbitMQ. Enviando a DLQ.', parseError);
      channel.nack(msg, false, false);
      return;
    }

    const eventId = String(payload.eventId || msg.properties.messageId || '');
    const rawEventType = String(payload.eventType || msg.fields.routingKey || '');
    const rawDriverId = payload.driverId;
    const tripId = String(payload.tripId || 'N/A');

    // Validación de formato del mensaje (Requerimiento 7)
    const driverId = Number.parseInt(String(rawDriverId), 10);

    if (!eventId || !rawEventType || Number.isNaN(driverId) || driverId <= 0) {
      Logger.warn('Mensaje de RabbitMQ descartado por formato inválido (falta eventId, eventType o driverId entero válido). Enviando a DLQ.', {
        payload,
        parsedDriverId: driverId
      });
      channel.nack(msg, false, false);
      return;
    }

    // 1. Verificación de Idempotencia por eventId (RNF-08)
    const alreadyProcessed = await this.eventStore.isEventProcessed(eventId);
    if (alreadyProcessed) {
      Logger.info(`Evento duplicado ignorado por idempotencia: eventId=${eventId}`, { eventId, driverId, rawEventType });
      channel.ack(msg);
      return;
    }

    // Contar reintentos previos mediante headers de RabbitMQ
    const deathHeader = msg.properties.headers?.['x-death'];
    const retryCount = deathHeader && Array.isArray(deathHeader) && deathHeader.length > 0
      ? Number(deathHeader[0].count || 0)
      : 0;

    try {
      const tripEvent: TripEvent = {
        eventId,
        tripId,
        driverId,
        eventType: rawEventType as TripEvent['eventType'],
        timestamp: String(payload.occurredAt || payload.timestamp || new Date().toISOString())
      };

      // 2. Procesar la actualización en Redis y emitir disponibilidad (RNF-07)
      await this.tripEventHandler.handleTripEvent(tripEvent);

      // 3. Registrar idempotencia en Redis
      await this.eventStore.markEventProcessed(eventId);

      // 4. Confirmar ACK SOLO después de actualizar la caché
      channel.ack(msg);
      Logger.info(`Mensaje de evento de viaje procesado y confirmado (ACK): eventId=${eventId}`, {
        eventId,
        driverId,
        eventType: rawEventType
      });
    } catch (error) {
      Logger.error(`Error al procesar evento de viaje ${rawEventType} para driver ${driverId}`, error, {
        eventId,
        retryCount
      });

      if (retryCount >= this.maxRetries) {
        Logger.error(`Máximo de reintentos (${this.maxRetries}) superado para eventId ${eventId}. Enviando a DLQ.`, error);
        channel.nack(msg, false, false);
      } else {
        Logger.warn(`Reintentando procesamiento de eventId ${eventId} (intento ${retryCount + 1}/${this.maxRetries})`);
        channel.nack(msg, false, true);
      }
    }
  }
}

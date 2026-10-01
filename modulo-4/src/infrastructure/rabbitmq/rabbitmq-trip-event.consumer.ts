import type amqp from 'amqplib';
import type { TripEvent } from '../../domain/entities/location.entity.js';
import type { EventStore } from '../../ports/event-store.port.js';
import type { TripEventHandler } from '../../application/event-handlers/trip-event.handler.js';
import { Logger } from '../logger/structured.logger.js';
import type { RabbitMQConnection } from './rabbitmq.connection.js';

export class RabbitMQTripEventConsumer {
  private readonly maxRetries = 3;

  public constructor(
    private readonly connectionManager: RabbitMQConnection,
    private readonly tripEventHandler: TripEventHandler,
    private readonly eventStore: EventStore
  ) {}

  public async startConsuming(): Promise<void> {
    try {
      const channel = await this.connectionManager.getChannel();
      if (!channel) {
        Logger.warn('RabbitMQ no está disponible para iniciar el consumidor de eventos de viaje');
        return;
      }

      const queueName = 'm4.trip-events.queue';
      await channel.prefetch(1);

      Logger.info(`Iniciando consumo de cola RabbitMQ '${queueName}'`);

      await channel.consume(
        queueName,
        async (msg) => {
          if (!msg) return;

          try {
            await this.processMessage(channel, msg);
          } catch (error) {
            Logger.error('Error no capturado en el consumidor de eventos de viaje', error);
            channel.nack(msg, false, false);
          }
        },
        { noAck: false }
      );
    } catch (error) {
      Logger.error('Falla al iniciar el consumidor RabbitMQ', error);
    }
  }

  public async processMessage(channel: amqp.Channel, msg: amqp.ConsumeMessage): Promise<void> {
    let payload: Partial<TripEvent>;
    try {
      payload = JSON.parse(msg.content.toString('utf8'));
    } catch (parseError) {
      Logger.error('Error de formato JSON en mensaje recibido de RabbitMQ. Enviando a DLQ.', parseError);
      channel.nack(msg, false, false);
      return;
    }

    const eventId = payload.eventId || msg.properties.messageId;
    const eventType = (payload.eventType || msg.fields.routingKey) as TripEvent['eventType'];
    const driverId = payload.driverId;
    const tripId = payload.tripId || 'N/A';

    if (!eventId || !driverId || !eventType) {
      Logger.warn('Mensaje de RabbitMQ incompleto (falta eventId, driverId o eventType). Enviando a DLQ.', { payload });
      channel.nack(msg, false, false);
      return;
    }

    // 1. Verificación de Idempotencia (RNF-08)
    const alreadyProcessed = await this.eventStore.isEventProcessed(eventId);
    if (alreadyProcessed) {
      Logger.info(`Evento duplicado ignorado por idempotencia: eventId=${eventId}`, { eventId, driverId, eventType });
      // Confirmar inmediatamente para remover el duplicado de la cola
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
        eventType,
        timestamp: payload.timestamp || new Date().toISOString()
      };

      // 2. Procesar la actualización en Redis y emitir disponibilidad (RNF-07)
      await this.tripEventHandler.handleTripEvent(tripEvent);

      // 3. Registrar idempotencia en Redis
      await this.eventStore.markEventProcessed(eventId);

      // 4. Confirmar ACK SOLO después de actualizar satisfactoriamente la caché
      channel.ack(msg);
      Logger.info(`Mensaje de evento de viaje procesado y confirmado (ACK): eventId=${eventId}`, {
        eventId,
        driverId,
        eventType
      });
    } catch (error) {
      Logger.error(`Error al procesar evento de viaje ${eventType} para driver ${driverId}`, error, {
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

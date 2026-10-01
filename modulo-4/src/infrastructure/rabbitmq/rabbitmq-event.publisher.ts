import type { DriverAvailabilityChangedEvent } from '../../domain/entities/location.entity.js';
import type { EventPublisher } from '../../ports/event-publisher.port.js';
import { Logger } from '../logger/structured.logger.js';
import type { RabbitMQConnection } from './rabbitmq.connection.js';

export class RabbitMQEventPublisher implements EventPublisher {
  public constructor(private readonly connectionManager: RabbitMQConnection) {}

  public async publishDriverAvailabilityChanged(event: DriverAvailabilityChangedEvent): Promise<void> {
    try {
      const channel = await this.connectionManager.getChannel();
      if (!channel) {
        Logger.warn(`RabbitMQ no disponible. No se pudo publicar DriverAvailabilityChanged para ${event.driverId}`, {
          event
        });
        return;
      }

      const exchange = 'driver.events';
      const routingKey = 'driver.availability_changed';
      const payload = Buffer.from(JSON.stringify(event));

      const published = channel.publish(exchange, routingKey, payload, {
        persistent: true,
        messageId: event.eventId,
        timestamp: Date.now(),
        contentType: 'application/json'
      });

      if (published) {
        Logger.info(`Evento DriverAvailabilityChanged publicado con éxito para conductor ${event.driverId}`, {
          eventId: event.eventId,
          driverId: event.driverId,
          available: event.available
        });
      } else {
        Logger.warn(`Buffer de RabbitMQ lleno al publicar DriverAvailabilityChanged para ${event.driverId}`);
      }
    } catch (error) {
      Logger.error(`Error al publicar evento DriverAvailabilityChanged para conductor ${event.driverId}`, error, {
        event
      });
    }
  }
}

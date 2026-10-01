import type { DriverAvailabilityChangedEvent, TripEvent } from '../../domain/entities/location.entity.js';
import type { EventPublisher } from '../../ports/event-publisher.port.js';
import type { LocationRepository } from '../../ports/location-repository.port.js';
import { Logger } from '../../infrastructure/logger/structured.logger.js';

export class TripEventHandler {
  public constructor(
    private readonly locationRepository: LocationRepository,
    private readonly eventPublisher: EventPublisher
  ) {}

  public async handleTripEvent(event: TripEvent): Promise<void> {
    const { driverId, eventType, eventId } = event;
    const currentLocation = await this.locationRepository.get(driverId);

    if (!currentLocation) {
      Logger.warn(`No se encontró ubicación activa en Redis para el conductor ${driverId} al procesar ${eventType}`, {
        eventId,
        driverId,
        eventType
      });
      return;
    }

    let newAvailability = currentLocation.available;
    if (eventType === 'TripStarted') {
      newAvailability = false;
    } else if (eventType === 'TripCompleted' || eventType === 'TripCancelled') {
      newAvailability = true;
    }

    if (currentLocation.available !== newAvailability) {
      const updatedLocation = {
        ...currentLocation,
        available: newAvailability,
        updatedAt: new Date().toISOString()
      };

      await this.locationRepository.saveIfNewer(updatedLocation, 60);

      Logger.info(
        `Disponibilidad del conductor ${driverId} actualizada a ${newAvailability} por evento ${eventType}`,
        { eventId, driverId, available: newAvailability }
      );

      // Emite evento DriverAvailabilityChanged
      const availabilityEvent: DriverAvailabilityChangedEvent = {
        eventId: `avail-${eventId}-${Date.now()}`,
        driverId,
        available: newAvailability,
        timestamp: new Date().toISOString()
      };

      await this.eventPublisher.publishDriverAvailabilityChanged(availabilityEvent);
    }
  }
}

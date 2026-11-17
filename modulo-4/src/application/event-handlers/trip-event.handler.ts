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

    if (!Number.isInteger(driverId) || driverId <= 0) {
      Logger.warn(`Evento de viaje ignorado: driverId no es un entero válido (${driverId})`, { eventId, driverId });
      return;
    }

    const currentLocation = await this.locationRepository.get(driverId);

    if (!currentLocation) {
      Logger.warn(`No se encontró ubicación activa en Redis para el conductor ${driverId} al procesar ${eventType}`, {
        eventId,
        driverId,
        eventType
      });
      return;
    }

    // Normalización de tipos de evento (soporta propuesta previa 'TripStarted' y propuesta M6 'viaje.iniciado')
    const normalizedType = String(eventType).toLowerCase();
    let newAvailability = currentLocation.available;

    if (normalizedType === 'tripstarted' || normalizedType === 'viaje.iniciado') {
      newAvailability = false;
    } else if (
      normalizedType === 'tripcompleted' ||
      normalizedType === 'viaje.finalizado' ||
      normalizedType === 'tripcancelled' ||
      normalizedType === 'viaje.cancelado'
    ) {
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

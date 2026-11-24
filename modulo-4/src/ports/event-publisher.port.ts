import type { DriverAvailabilityChangedEvent } from '../domain/entities/location.entity.js';

export interface EventPublisher {
  publishDriverAvailabilityChanged(event: DriverAvailabilityChangedEvent): Promise<void>;
}

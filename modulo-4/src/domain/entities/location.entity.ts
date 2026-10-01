export type VehicleType = 'AUTO' | 'MOTO';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface DriverLocation extends Coordinates {
  driverId: string;
  vehicleType: VehicleType;
  available: boolean;
  updatedAt: string;
  expiresAt: string;
}

export interface NearbyDriver extends DriverLocation {
  distanceKm: number;
  estimatedEtaMinutes: number;
}

export interface DistanceEstimate {
  distanceKm: number;
  estimatedEtaMinutes: number;
}

export interface GeocodedAddress extends Coordinates {
  address: string;
  provider: string;
}

export interface TripEvent {
  eventId: string;
  tripId: string;
  driverId: string;
  eventType: 'TripStarted' | 'TripCompleted' | 'TripCancelled';
  timestamp: string;
}

export interface DriverAvailabilityChangedEvent {
  eventId: string;
  driverId: string;
  available: boolean;
  timestamp: string;
}

export type VehicleType = 'AUTO' | 'MOTO';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface DriverLocation extends Coordinates {
  driverId: number; // Identificador canónico del conductor como número entero positivo
  vehicleType: VehicleType;
  available: boolean;
  updatedAt: string;
  expiresAt: string;
}

export interface LocationHistoryRecord extends Coordinates {
  id?: number;
  driverId: number;
  vehicleType: VehicleType;
  available: boolean;
  updatedAt: string;
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
  driverId: number;
  eventType: 'TripStarted' | 'TripCompleted' | 'TripCancelled' | 'viaje.iniciado' | 'viaje.finalizado' | 'viaje.cancelado';
  timestamp: string;
}

export interface DriverAvailabilityChangedEvent {
  eventId: string;
  driverId: number;
  available: boolean;
  timestamp: string;
}

export interface M1UserValidationResponse {
  valid: boolean;
  userId: number;
  role: string;
}

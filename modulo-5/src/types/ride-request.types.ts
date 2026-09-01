/**
 * Módulo 5: Solicitud y Despacho
 * Definición de tipos de dominio y contratos DTO
 */

export type VehicleType = 'AUTO' | 'MOTO';

export type RideRequestStatus =
  | 'PENDING'
  | 'SEARCHING'
  | 'OFFERED'
  | 'ASSIGNED'
  | 'CANCELLED_BY_CLIENT'
  | 'EXPIRED'
  | 'NO_DRIVERS_AVAILABLE';

export interface GeoLocation {
  latitude: number;
  longitude: number;
  address: string;
}

export interface EstimatedFare {
  amount: number;
  currency: string;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  fareToken?: string;
}

export interface RideRequest {
  id: string;
  clientId: string;
  origin: GeoLocation;
  destination: GeoLocation;
  vehicleType: VehicleType;
  status: RideRequestStatus;
  estimatedFare: EstimatedFare;
  assignedDriverId?: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface CreateRideRequestDTO {
  origin: GeoLocation;
  destination: GeoLocation;
  vehicleType: VehicleType;
}

export interface CancelRideRequestDTO {
  reason?: string;
}

export interface NearbyDriverStub {
  driverId: string;
  distanceKm: number;
  vehicleType: VehicleType;
}

export interface ErrorResponseDTO {
  code: string;
  message: string;
  details?: string[];
  timestamp: string;
}

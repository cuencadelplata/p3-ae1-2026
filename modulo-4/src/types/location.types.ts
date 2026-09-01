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

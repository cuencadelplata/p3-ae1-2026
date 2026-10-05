export type VehicleType = 'AUTO' | 'MOTO';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface DriverLocation extends Coordinates {
  driverId: number;
  vehicleType: VehicleType;
  available: boolean;
  updatedAt: string;
  expiresAt: string;
}

export interface NearbyDriver extends DriverLocation {
  distanceKm: number;
  estimatedEtaMinutes: number;
}

export interface LocationHistoryEntry extends Omit<DriverLocation, 'expiresAt'> {
  id: number;
  recordedAt: string;
  createdAt: string;
}

export interface DistanceEstimate {
  distanceKm: number;
  estimatedEtaMinutes: number;
}

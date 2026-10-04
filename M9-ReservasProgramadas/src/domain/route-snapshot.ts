export interface GeoLocation {
  latitude: number;
  longitude: number;
  address: string;
}

export interface RouteSnapshot {
  origin: GeoLocation;
  destination: GeoLocation;
  distanceKm: number;
  estimatedDurationMin: number;
}

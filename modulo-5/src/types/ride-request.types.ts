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

export interface NearbyDriverStub {
  driverId: string;
  distanceKm: number;
  vehicleType: VehicleType;
  latitude?: number;
  longitude?: number;
  rating?: number;
}

export interface CandidateDriver {
  driverId: string;
  vehicleType: VehicleType;
  distanceKm: number;
  estimatedEtaMinutes: number;
  rating?: number;
}

export interface SearchCandidatesOptions {
  radiusKm?: number;
  maxCandidates?: number;
}

export interface CandidateSearchResponseDTO {
  requestId: string;
  vehicleType: VehicleType;
  searchRadiusKm: number;
  candidatesCount: number;
  candidates: CandidateDriver[];
  searchTimestamp: string;
}

export interface ErrorResponseDTO {
  code: string;
  message: string;
  details?: string[];
  timestamp: string;
}

/**
 * Tipos para RF-5.3: Oferta con vencimiento
 */
export type RideOfferStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

export interface RideOffer {
  id: string;
  requestId: string;
  driverId: string;
  status: RideOfferStatus;
  estimatedFare: EstimatedFare;
  origin: GeoLocation;
  destination: GeoLocation;
  vehicleType: VehicleType;
  ttlSeconds: number;
  createdAt: string;
  expiresAt: string;
}

export interface SendOffersDTO {
  driverIds?: string[]; // Si no se envían, toma los mejores candidatos encontrados
  ttlSeconds?: number;  // Tiempo de expiración de la oferta (ej. 15 a 60 seg, default 30 seg)
}

export interface SendOffersResponseDTO {
  requestId: string;
  offersSentCount: number;
  offers: RideOffer[];
  message: string;
}

/**
 * Tipos para RF-5.4: Aceptar o rechazar oferta
 */
export type OfferAction = 'ACCEPT' | 'REJECT';

export interface RespondOfferDTO {
  action: OfferAction;
  driverId?: string; // Opcional en el body si se envía por header / token JWT
}

export interface RespondOfferResponseDTO {
  offerId: string;
  requestId: string;
  driverId: string;
  action: OfferAction;
  status: RideOfferStatus;
  requestStatus: RideRequestStatus;
  assignedDriverId?: string | null;
  message: string;
  respondedAt: string;
}




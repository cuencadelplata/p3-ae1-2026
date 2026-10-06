export type VehicleType = 'auto' | 'moto';
export type NotificationChannel = 'email' | 'push';
export type AccountStatusEnum =
  | 'ACTIVO'
  | 'INACTIVO'
  | 'BLOQUEADO_TEMPORAL'
  | 'BLOQUEADO_PERMANENTE'
  | 'EN_REVISIÓN';

export type BlockOrigin = 'AUTOMATICO' | 'MANUAL';

export interface Preferences {
  preferredVehicleType: VehicleType;
  notificationChannel: NotificationChannel;
}

/** Datos personales del usuario, propiedad de M1 (los trae M2 al consultar el perfil). */
export interface CustomerIdentity {
  nombre: string;
  apellido: string;
  dni: string | null;
  telefono: string | null;
  email: string;
  rol: string;
  estado: string;
  creadoEn: string | null;
}

export interface CustomerProfile {
  customerId: string;
  userId: number;
  preferences: Preferences;
  status: AccountStatusEnum;
  createdAt: string;
  updatedAt?: string;
  /** null si M1 no respondió o el perfil no es del usuario autenticado. */
  identity?: CustomerIdentity | null;
}

export interface AccountStatusResponse {
  customerId: string;
  status: AccountStatusEnum;
  reason: string;
  updatedAt: string;
  blockOrigin?: BlockOrigin;
}

export interface TripSummary {
  tripId: string;
  origin: string;
  destination: string;
  fare: number | null;
  status: string;
  createdAt: string;
}

export interface CustomerTripsResponse {
  customerId: string;
  tripsCount: number;
  trips: TripSummary[];
  degraded: boolean;
}

export interface CreateCustomerDTO {
  preferences?: Partial<Preferences>;
}

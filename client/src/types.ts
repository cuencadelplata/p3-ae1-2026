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

export interface CustomerProfile {
  customerId: string;
  userId: number;
  preferences: Preferences;
  status: AccountStatusEnum;
  createdAt: string;
  updatedAt?: string;
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
  fare: number;
  status: string;
  createdAt: string;
}

export interface CustomerTripsResponse {
  customerId: string;
  tripsCount: number;
  trips: TripSummary[];
}

export interface CreateCustomerDTO {
  preferences?: Partial<Preferences>;
}

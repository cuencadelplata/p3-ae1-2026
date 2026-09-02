export type VehicleType = 'auto' | 'moto';
export type NotificationChannel = 'email' | 'push';
export type AccountStatusEnum =
  | 'ACTIVO'
  | 'BLOQUEADO_TEMPORAL'
  | 'BLOQUEADO_PERMANENTE'
  | 'EN_REVISIÓN';

export interface Preferences {
  preferredVehicleType: VehicleType;
  notificationChannel: NotificationChannel;
  defaultHomeAddress?: string;
  defaultWorkAddress?: string;
}

export interface CustomerProfile {
  customerId: string;
  name: string;
  email: string;
  phone: string;
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
  name: string;
  email: string;
  phone: string;
  preferences?: Partial<Preferences>;
}

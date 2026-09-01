import { z } from 'zod';

// Tipos permitidos para vehículos y notificaciones
export const VehicleTypeSchema = z.enum(['auto', 'moto']);
export type VehicleType = z.infer<typeof VehicleTypeSchema>;

export const NotificationChannelSchema = z.enum(['email', 'push']);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

// Estados de cuenta posibles
export const AccountStatusEnumSchema = z.enum([
  'ACTIVO',
  'BLOQUEADO_TEMPORAL',
  'BLOQUEADO_PERMANENTE',
  'EN_REVISIÓN'
]);
export type AccountStatusEnum = z.infer<typeof AccountStatusEnumSchema>;

// Esquema de preferencias del cliente
export const PreferencesSchema = z.object({
  preferredVehicleType: VehicleTypeSchema.default('auto'),
  notificationChannel: NotificationChannelSchema.default('email'),
  defaultHomeAddress: z.string().optional(),
  defaultWorkAddress: z.string().optional()
});
export type Preferences = z.infer<typeof PreferencesSchema>;

// Esquema para registrar un cliente (POST /v1/customers)
export const CreateCustomerSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  email: z.string().email('Formato de correo electrónico inválido'),
  phone: z.string().min(6, 'El teléfono debe tener al menos 6 caracteres'),
  preferences: PreferencesSchema.optional().default({
    preferredVehicleType: 'auto',
    notificationChannel: 'email'
  })
});
export type CreateCustomerDTO = z.infer<typeof CreateCustomerSchema>;

// Esquema para actualizar preferencias (PUT /v1/customers/:id)
export const UpdatePreferencesSchema = z.object({
  preferences: PreferencesSchema
});
export type UpdatePreferencesDTO = z.infer<typeof UpdatePreferencesSchema>;

// Interfaces del Dominio
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

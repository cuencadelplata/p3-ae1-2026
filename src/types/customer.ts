import { z } from 'zod';

// Tipos permitidos para vehículos y notificaciones
export const VehicleTypeSchema = z.enum(['auto', 'moto']);
export type VehicleType = z.infer<typeof VehicleTypeSchema>;

export const NotificationChannelSchema = z.enum(['email', 'push']);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const UserIdSchema = z.number().int().positive().brand<'UserId'>();
export type UserId = z.infer<typeof UserIdSchema>;

// Estados de cuenta posibles (INACTIVO = baja del cliente; nunca se borra físicamente)
export const AccountStatusEnumSchema = z.enum([
  'ACTIVO',
  'INACTIVO',
  'BLOQUEADO_TEMPORAL',
  'BLOQUEADO_PERMANENTE',
  'EN_REVISIÓN'
]);
export type AccountStatusEnum = z.infer<typeof AccountStatusEnumSchema>;

// Esquema de preferencias del cliente
export const PreferencesSchema = z.object({
  preferredVehicleType: VehicleTypeSchema.default('auto'),
  notificationChannel: NotificationChannelSchema.default('email')
}).strict();
export type Preferences = Readonly<z.infer<typeof PreferencesSchema>>;

// Esquema para registrar un cliente (POST /v1/customers)
export const CreateCustomerSchema = z.object({
  preferences: PreferencesSchema.optional().default({
    preferredVehicleType: 'auto',
    notificationChannel: 'email'
  })
}).strict();
export type CreateCustomerDTO = Readonly<z.infer<typeof CreateCustomerSchema>>;

// Esquema para actualizar preferencias (PUT /v1/customers/:id)
export const UpdatePreferencesSchema = z.object({
  preferences: PreferencesSchema
}).strict();
export type UpdatePreferencesDTO = Readonly<z.infer<typeof UpdatePreferencesSchema>>;

// Esquema para cambiar el estado de cuenta (PUT /v1/customers/:id/status)
export const UpdateAccountStatusSchema = z.object({
  status: AccountStatusEnumSchema,
  reason: z.string().min(3, 'El motivo debe tener al menos 3 caracteres')
});
export type UpdateAccountStatusDTO = z.infer<typeof UpdateAccountStatusSchema>;

// Interfaces del Dominio
export const CustomerProfileSchema = z.object({
  customerId: z.string().regex(/^cust_[0-9a-f]{8}$/),
  userId: UserIdSchema,
  preferences: PreferencesSchema,
  status: AccountStatusEnumSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }).optional()
}).strict();
export type CustomerProfile = Readonly<z.infer<typeof CustomerProfileSchema>>;

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

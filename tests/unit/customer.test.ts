import { describe, it, expect } from 'vitest';
import { CreateCustomerSchema, UpdatePreferencesSchema, UpdateAccountStatusSchema } from '../../src/types/customer.js';

describe('Validaciones de Dominio (Zod Schemas)', () => {
  it('acepta un alta sin datos personales y aplica las preferencias por defecto', () => {
    const result = CreateCustomerSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        preferences: {
          preferredVehicleType: 'auto',
          notificationChannel: 'email'
        }
      });
    }
  });

  it('acepta un alta con las preferencias opcionales explícitas', () => {
    const validData = {
      preferences: {
        preferredVehicleType: 'moto',
        notificationChannel: 'push'
      }
    };

    const result = CreateCustomerSchema.safeParse(validData);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preferences).toEqual(validData.preferences);
    }
  });

  it('rechaza datos personales porque la identidad pertenece a M1', () => {
    const dataOwnedByM1 = {
      name: 'Juan Pérez',
      email: 'juan.perez@example.com',
      phone: '+5493512345678'
    };

    const result = CreateCustomerSchema.safeParse(dataOwnedByM1);

    expect(result.success).toBe(false);
  });

  it('debe rechazar un tipo de vehículo no permitido (ej. bicicleta)', () => {
    const invalidData = {
      preferences: {
        preferredVehicleType: 'bicicleta',
        notificationChannel: 'email'
      }
    };

    const result = UpdatePreferencesSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it('rechaza direcciones dentro de RF-2.1 porque pertenecen a RF-2.2', () => {
    const dataWithAddress = {
      preferences: {
        preferredVehicleType: 'auto',
        notificationChannel: 'email',
        defaultHomeAddress: 'Av. Siempre Viva 742'
      }
    };

    const result = CreateCustomerSchema.safeParse(dataWithAddress);

    expect(result.success).toBe(false);
  });

  it('debe aceptar INACTIVO como estado de baja con un motivo', () => {
    const result = UpdateAccountStatusSchema.safeParse({ status: 'INACTIVO', reason: 'Baja solicitada por el cliente' });
    expect(result.success).toBe(true);
  });

  it('debe rechazar un estado de cuenta inexistente (ej. ELIMINADO)', () => {
    const result = UpdateAccountStatusSchema.safeParse({ status: 'ELIMINADO', reason: 'Borrado' });
    expect(result.success).toBe(false);
  });

  it('debe rechazar un cambio de estado sin motivo', () => {
    const result = UpdateAccountStatusSchema.safeParse({ status: 'INACTIVO' });
    expect(result.success).toBe(false);
  });
});

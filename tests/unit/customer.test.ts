import { describe, it, expect } from 'vitest';
import { CreateCustomerSchema, UpdatePreferencesSchema } from '../../src/types/customer.js';

describe('Validaciones de Dominio (Zod Schemas)', () => {
  it('debe validar y aceptar un cliente con datos válidos', () => {
    const validData = {
      name: 'Juan Pérez',
      email: 'juan.perez@example.com',
      phone: '+5493512345678',
      preferences: {
        preferredVehicleType: 'auto',
        notificationChannel: 'email'
      }
    };

    const result = CreateCustomerSchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Juan Pérez');
      expect(result.data.email).toBe('juan.perez@example.com');
    }
  });

  it('debe rechazar un email con formato inválido', () => {
    const invalidData = {
      name: 'Juan Pérez',
      email: 'correo-invalido-sin-arroba',
      phone: '+5493512345678'
    };

    const result = CreateCustomerSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it('debe rechazar un nombre demasiado corto (menos de 2 caracteres)', () => {
    const invalidData = {
      name: 'J',
      email: 'juan@example.com',
      phone: '+5493512345678'
    };

    const result = CreateCustomerSchema.safeParse(invalidData);
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

  it('debe asignar valores por defecto en preferencias si no se envían', () => {
    const dataWithoutPreferences = {
      name: 'Carlos Gómez',
      email: 'carlos@example.com',
      phone: '+5493519876543'
    };

    const result = CreateCustomerSchema.safeParse(dataWithoutPreferences);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preferences.preferredVehicleType).toBe('auto');
      expect(result.data.preferences.notificationChannel).toBe('email');
    }
  });
});

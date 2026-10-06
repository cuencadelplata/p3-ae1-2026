import { describe, expect, it } from 'vitest';
import { ForbiddenError, UnauthorizedError } from '../../src/domain/errors/location.errors.js';
import { M1AuthAdapter } from '../../src/infrastructure/auth/m1-auth.adapter.js';

describe('M1AuthAdapter (Requerimiento 2)', () => {
  it('debe validar exitosamente en modo skipValidation para pruebas', async () => {
    const adapter = new M1AuthAdapter('http://localhost:3001', true);
    const result = await adapter.validateConductorIdentity('Bearer fake-token', 101);

    expect(result.valid).toBe(true);
    expect(result.userId).toBe(101);
    expect(result.role).toBe('CONDUCTOR');
  });

  it('debe lanzar UnauthorizedError si no se envía un token Bearer', async () => {
    const adapter = new M1AuthAdapter('http://localhost:3001', false);
    await expect(adapter.validateConductorIdentity('', 101)).rejects.toThrow(UnauthorizedError);
  });
});

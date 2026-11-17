import { afterEach, describe, expect, it, vi } from 'vitest';
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

  describe('respuestas del servicio M1', () => {
    const mockM1Response = (status: number, body: unknown) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
      );
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    };

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('debe aceptar un conductor valido y agregar el prefijo Bearer al token', async () => {
      const fetchMock = mockM1Response(200, { valid: true, userId: 101, role: 'CONDUCTOR' });
      const adapter = new M1AuthAdapter('http://m1.local/', false);

      const result = await adapter.validateConductorIdentity('token-123', 101);

      expect(result).toEqual({ valid: true, userId: 101, role: 'CONDUCTOR' });
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('http://m1.local/auth/validar-identidad-y-rol');
      expect(options.headers.Authorization).toBe('Bearer token-123');
    });

    it('debe lanzar UnauthorizedError si M1 responde con un estado no exitoso', async () => {
      mockM1Response(401, { message: 'token vencido' });
      const adapter = new M1AuthAdapter('http://m1.local', false);

      await expect(adapter.validateConductorIdentity('Bearer x', 101)).rejects.toThrow(UnauthorizedError);
    });

    it('debe lanzar ForbiddenError si el rol no es CONDUCTOR', async () => {
      mockM1Response(200, { valid: true, userId: 101, role: 'PASAJERO' });
      const adapter = new M1AuthAdapter('http://m1.local', false);

      await expect(adapter.validateConductorIdentity('Bearer x', 101)).rejects.toThrow(ForbiddenError);
    });

    it('debe lanzar ForbiddenError si el userId no coincide con el driverId', async () => {
      mockM1Response(200, { valid: true, userId: 999, role: 'CONDUCTOR' });
      const adapter = new M1AuthAdapter('http://m1.local', false);

      await expect(adapter.validateConductorIdentity('Bearer x', 101)).rejects.toThrow(ForbiddenError);
    });

    it('debe lanzar UnauthorizedError si M1 no esta disponible', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
      const adapter = new M1AuthAdapter('http://m1.local', false);

      await expect(adapter.validateConductorIdentity('Bearer x', 101)).rejects.toThrow(UnauthorizedError);
    });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { M1IdentityClient } from '../src/auth/m1-identity.client.js';
import {
  AuthenticationError,
  AuthorizationError,
  IdentityServiceUnavailableError
} from '../src/auth/identity.types.js';

describe('Integracion de identidad con M1', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('acepta el userId canonico de un conductor valido', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ valid: true, userId: 13, role: 'CONDUCTOR' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const identity = await new M1IdentityClient('http://m1:3001').validate('Bearer token-valido');

    expect(identity).toEqual({ userId: 13, role: 'CONDUCTOR' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://m1:3001/auth/validar-identidad-y-rol',
      expect.objectContaining({ headers: { Authorization: 'Bearer token-valido' } })
    );
  });

  it('rechaza tokens faltantes, invalidos o usuarios bloqueados', async () => {
    const client = new M1IdentityClient('http://m1:3001');
    await expect(client.validate()).rejects.toThrow(AuthenticationError);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ valid: false, error: 'Token expirado' }), { status: 401 })
    ));
    await expect(client.validate('Bearer vencido')).rejects.toThrow(AuthenticationError);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ valid: false, userId: 13, role: 'CONDUCTOR' }), { status: 200 })
    ));
    await expect(client.validate('Bearer bloqueado')).rejects.toThrow(AuthenticationError);
  });

  it('rechaza identidades validas que no sean conductores', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ valid: true, userId: 8, role: 'CLIENTE' }), { status: 200 })
    ));

    await expect(
      new M1IdentityClient('http://m1:3001').validate('Bearer cliente')
    ).rejects.toThrow(AuthorizationError);
  });

  it('informa indisponibilidad cuando M1 no responde', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    await expect(
      new M1IdentityClient('http://m1:3001').validate('Bearer token')
    ).rejects.toThrow(IdentityServiceUnavailableError);
  });
});

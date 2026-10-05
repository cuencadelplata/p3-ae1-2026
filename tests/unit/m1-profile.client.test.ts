import { describe, it, expect, vi, afterEach } from 'vitest';
import { M1ProfileClient } from '../../src/clients/m1-profile.client.js';
import { ServiceUnavailableError } from '../../src/errors/service-unavailable.error.js';
import type { ResiliencePolicy } from '../../src/resilience/policies.js';

const passthrough: ResiliencePolicy = { execute: (operation) => operation(new AbortController().signal) };
const client = () => new M1ProfileClient(() => 'http://m1/', passthrough);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Respuesta real de M1 GET /auth/me (user-profile.service.ts de integration/m1-ae2)
const m1Body = {
  userId: 12, nombre: 'Ana', apellido: 'Pérez', dni: 30111222, telefono: '+54 9 362 4111222',
  email: 'ana@example.com', rol: 'CLIENTE', estado: 'ACTIVO', creadoEn: '2026-09-01T12:00:00.000Z'
};

describe('M1ProfileClient (datos personales de M1)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('consulta GET /auth/me con el token del usuario y mapea la respuesta de M1', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(m1Body));
    vi.stubGlobal('fetch', fetchMock);

    const identity = await client().getIdentity('tok');

    expect(fetchMock.mock.calls[0][0]).toBe('http://m1/auth/me');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    expect(identity).toEqual({ ...m1Body, dni: '30111222' }); // DNI numérico se normaliza a texto
  });

  it('acepta campos opcionales ausentes (dni, teléfono, creadoEn)', async () => {
    const { dni: _d, telefono: _t, creadoEn: _c, ...minimo } = m1Body;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(minimo)));

    expect(await client().getIdentity('tok')).toMatchObject({ dni: null, telefono: null, creadoEn: null });
  });

  it('401, 403 (usuario bloqueado) y 404 (usuario inexistente) → null', async () => {
    for (const status of [401, 403, 404]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'x' }, status)));
      expect(await client().getIdentity('tok')).toBeNull();
    }
  });

  it('5xx o red caída → ServiceUnavailableError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'x' }, 500)));
    await expect(client().getIdentity('tok')).rejects.toBeInstanceOf(ServiceUnavailableError);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(client().getIdentity('tok')).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it('una respuesta fuera de contrato no se toma como datos válidos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ userId: 12, nombre: 'Ana' })));
    await expect(client().getIdentity('tok')).rejects.toThrow(/fuera de contrato/);
  });
});

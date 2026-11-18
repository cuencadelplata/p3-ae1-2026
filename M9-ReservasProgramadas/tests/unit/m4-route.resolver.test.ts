import { afterEach, describe, expect, it, vi } from 'vitest';
import { M4RouteResolver } from '../../src/clients/m4-route.resolver.js';

describe('M4RouteResolver', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('geocodifica ambos extremos y usa la distancia/ETA de M4 para M7 y M5', async () => {
    const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return {
        ok: true,
        json: async () =>
          url.pathname.endsWith('estimate')
            ? { distanceKm: 12.3, estimatedEtaMinutes: 21 }
            : body.address === 'Origen'
              ? { latitude: -27.46, longitude: -58.83 }
              : { latitude: -27.48, longitude: -58.78 },
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new M4RouteResolver('http://m4:3004', 1000).resolve('Origen', 'Destino'),
    ).resolves.toEqual({
      origin: { latitude: -27.46, longitude: -58.83, address: 'Origen' },
      destination: { latitude: -27.48, longitude: -58.78, address: 'Destino' },
      distanceKm: 12.3,
      estimatedDurationMin: 21,
    });
    expect(fetchMock.mock.calls.map(([url]) => url.pathname)).toEqual([
      '/api/v1/geocode',
      '/api/v1/geocode',
      '/api/v1/estimate',
    ]);
  });

  it('no inventa coordenadas cuando M4 responde con error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(
      new M4RouteResolver('http://m4:3004', 1000).resolve('Origen', 'Destino'),
    ).rejects.toMatchObject({ service: 'M4', kind: 'UNAVAILABLE' });
  });

  it('rechaza coordenadas inválidas sin consultar una tarifa ficticia', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ latitude: 200, longitude: 0 }) }),
    );
    await expect(
      new M4RouteResolver('http://m4:3004', 1000).resolve('Origen', 'Destino'),
    ).rejects.toThrow();
  });
});

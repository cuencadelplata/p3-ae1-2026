import { afterEach, describe, expect, it, vi } from 'vitest';

import { M7TariffClient } from '../../src/clients/m7-tariff.client.js';

const route = {
  origin: { latitude: -27.46, longitude: -58.83, address: 'Origen' },
  destination: { latitude: -27.48, longitude: -58.78, address: 'Destino' },
  distanceKm: 10,
  estimatedDurationMin: 20,
};

const response = {
  estimacionId: 'est_123',
  distanciaKm: 10,
  tiempoEstimadoMin: 20,
  vehicleType: 'auto',
  estimatedFare: 2_450,
  currency: 'ARS',
  calculadoEn: '2026-09-29T12:00:00.000Z',
};

describe('M7TariffClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['AUTO', 'auto'],
    ['MOTO', 'moto'],
  ] as const)('usa /tarifa/estimacion y transforma %s a %s', async (vehiculo, expected) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...response, vehicleType: expected }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await new M7TariffClient('http://m7:3000', 100).estimate({ vehiculo, route });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('http://m7:3000/tarifa/estimacion');
    expect(JSON.parse(String(init.body))).toMatchObject({
      vehicleType: expected,
      distanciaKm: 10,
      tiempoEstimadoMin: 20,
    });
    expect(result).toEqual({
      tarifaEstimada: 2_450,
      moneda: 'ARS',
      estimacionId: 'est_123',
      distanciaKm: 10,
      tiempoEstimadoMin: 20,
      calculadoEn: '2026-09-29T12:00:00.000Z',
    });
  });

  it('clasifica validación 400', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    await expect(
      new M7TariffClient('http://m7:3000', 100).estimate({ vehiculo: 'AUTO', route }),
    ).rejects.toMatchObject({ kind: 'VALIDATION', service: 'M7' });
  });

  it('clasifica timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: URL, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );
    await expect(
      new M7TariffClient('http://m7:3000', 1).estimate({ vehiculo: 'MOTO', route }),
    ).rejects.toMatchObject({ kind: 'TIMEOUT' });
  });

  it('clasifica indisponibilidad de red', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(
      new M7TariffClient('http://m7:3000', 100).estimate({ vehiculo: 'MOTO', route }),
    ).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });
});

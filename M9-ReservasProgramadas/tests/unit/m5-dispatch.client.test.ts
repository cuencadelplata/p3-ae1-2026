import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  M5DispatchClient,
  type DispatchOperationStore,
  type DispatchTokenProvider,
} from '../../src/clients/m5-dispatch.client.js';
import { ExternalServiceError } from '../../src/errors/external-service.error.js';

const tokenProvider: DispatchTokenProvider = {
  getAuthorization: async () => 'Bearer test-token',
};

const operationStore: DispatchOperationStore = {
  getOrCreate: async () => '11111111-1111-4111-8111-111111111111',
};

const input = {
  reserva: {
    id: '22222222-2222-4222-8222-222222222222',
    clienteId: '33333333-3333-4333-8333-333333333333',
    vehiculo: 'AUTO' as const,
  },
  origin: { latitude: -27.46, longitude: -58.83, address: 'Origen' },
  destination: { latitude: -27.48, longitude: -58.78, address: 'Destino' },
};

describe('M5DispatchClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('usa el contrato /api/v1, Bearer, idempotencia y mapea requestId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '44444444-4444-4444-8444-444444444444',
        clientId: 'client-1',
        status: 'PENDING',
        assignedDriverId: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new M5DispatchClient(
      'http://m5:3005',
      100,
      tokenProvider,
      operationStore,
    ).createRequest(input);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('http://m5:3005/api/v1/ride-requests');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer test-token',
      'idempotency-key': '11111111-1111-4111-8111-111111111111',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      origin: input.origin,
      destination: input.destination,
      vehicleType: 'AUTO',
    });
    expect(result).toMatchObject({
      requestId: '44444444-4444-4444-8444-444444444444',
      status: 'PENDING',
    });
  });

  it('conserva MOTO y reutiliza la misma clave para la misma operación lógica', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '44444444-4444-4444-8444-444444444444',
        clientId: 'client-1',
        status: 'SEARCHING',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const store = new (
      await import('../../src/clients/m5-dispatch.client.js')
    ).InMemoryDispatchOperationStore();
    const client = new M5DispatchClient('http://m5:3005', 100, tokenProvider, store);
    await client.createRequest({ ...input, reserva: { ...input.reserva, vehiculo: 'MOTO' } });
    await client.createRequest({ ...input, reserva: { ...input.reserva, vehiculo: 'MOTO' } });
    const calls = fetchMock.mock.calls as [URL, RequestInit][];
    expect(JSON.parse(String(calls[0]![1].body)).vehicleType).toBe('MOTO');
    expect((calls[0]![1].headers as Record<string, string>)['idempotency-key']).toBe(
      (calls[1]![1].headers as Record<string, string>)['idempotency-key'],
    );
  });

  it('consulta estado, mapea assignedDriverId y cancela con el contrato documentado', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: '44444444-4444-4444-8444-444444444444',
          clientId: 'client-1',
          status: 'ASSIGNED',
          assignedDriverId: 'driver-1',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          requestId: '44444444-4444-4444-8444-444444444444',
          clientId: 'client-1',
          status: 'CANCELLED',
          cancelledAt: '2026-09-29T12:00:00.000Z',
          message: 'Cancelada',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const client = new M5DispatchClient('http://m5:3005', 100, tokenProvider, operationStore);

    await expect(client.getRequest('44444444-4444-4444-8444-444444444444')).resolves.toMatchObject({
      status: 'ASSIGNED',
      assignedDriverId: 'driver-1',
    });
    await expect(
      client.cancelRequest('44444444-4444-4444-8444-444444444444', 'Cambio de planes'),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
    expect((fetchMock.mock.calls[1]![0] as URL).pathname).toBe(
      '/api/v1/ride-requests/44444444-4444-4444-8444-444444444444/cancel',
    );
  });

  it.each([400, 401, 403, 404, 409, 422, 503])(
    'clasifica una respuesta HTTP %i',
    async (status) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));
      const client = new M5DispatchClient('http://m5:3005', 100, tokenProvider, operationStore);
      await expect(client.createRequest(input)).rejects.toMatchObject({ service: 'M5' });
    },
  );

  it('distingue timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: URL, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );
    const client = new M5DispatchClient('http://m5:3005', 1, tokenProvider, operationStore);
    await expect(client.createRequest(input)).rejects.toMatchObject({ kind: 'TIMEOUT' });
  });

  it('distingue indisponibilidad de red', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const client = new M5DispatchClient('http://m5:3005', 100, tokenProvider, operationStore);
    await expect(client.createRequest(input)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it('rechaza invocaciones sin Bearer antes de llamar a red', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new M5DispatchClient(
      'http://m5:3005',
      100,
      { getAuthorization: async () => undefined },
      operationStore,
    );
    await expect(client.createRequest(input)).rejects.toBeInstanceOf(ExternalServiceError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

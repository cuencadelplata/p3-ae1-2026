import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportError } from '../errors/support-error.js';
import { createM6TripsClient } from './m6-trips.js';

const BASE_URL = 'http://m6.test:3000';
const TRIP_ID = '3f0c9c1e-6a51-4d0e-9b57-0c2d1a7f4b11';

function respuesta(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clienteCon(fetchImpl: typeof fetch, timeoutMs = 2000) {
  return createM6TripsClient({ baseUrl: BASE_URL, timeoutMs, fetchImpl });
}

function viaje(id: string) {
  return { id, clienteId: 'cliente-123', conductorId: null, estado: 'SOLICITADO' };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createM6TripsClient: existe', () => {
  it('consulta GET /api/viajes/{id} de M6 con el id codificado', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respuesta(200, viaje('viaje con/barra')));

    await clienteCon(fetchImpl).existe('viaje con/barra');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE_URL}/api/viajes/viaje%20con%2Fbarra`);
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('200 con el mismo id: el viaje existe', async () => {
    const cliente = clienteCon(async () => respuesta(200, viaje(TRIP_ID)));

    expect(await cliente.existe(TRIP_ID)).toBe(true);
  });

  it('el viaje existe en cualquier estado, también cancelado', async () => {
    const cliente = clienteCon(async () => respuesta(200, { ...viaje(TRIP_ID), estado: 'CANCELADO' }));

    expect(await cliente.existe(TRIP_ID)).toBe(true);
  });

  it('404: el viaje no existe', async () => {
    const cliente = clienteCon(async () => respuesta(404, { error: 'Viaje no encontrado' }));

    expect(await cliente.existe(TRIP_ID)).toBe(false);
  });

  it('400 (id con formato inválido para M6): el viaje no existe', async () => {
    const cliente = clienteCon(async () => respuesta(400, { error: 'Falta el id del viaje en la URL' }));

    expect(await cliente.existe('no-es-un-uuid')).toBe(false);
  });

  it.each([
    ['503 de M6', async () => respuesta(503, { error: 'Base de datos no disponible, intente más tarde' })],
    ['500 de M6', async () => respuesta(500, { error: 'Error interno' })],
    ['200 sin cuerpo JSON', async () => new Response('<html></html>', { status: 200 })],
    ['200 con un cuerpo que no es un viaje', async () => respuesta(200, { mensaje: 'ok' })],
    ['200 con el id de otro viaje', async () => respuesta(200, viaje('otro-viaje'))],
    [
      'error de red',
      async () => {
        throw new TypeError('fetch failed');
      },
    ],
  ])('%s: no se pudo verificar (SUPPORT_TRIP_SERVICE_UNAVAILABLE)', async (_caso, fetchImpl) => {
    const error = await clienteCon(fetchImpl as typeof fetch)
      .existe(TRIP_ID)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SupportError);
    expect(error).toMatchObject({ status: 503, code: 'SUPPORT_TRIP_SERVICE_UNAVAILABLE', retryAfterSeconds: 5 });
  });

  it('M6 no responde dentro del timeout: no se pudo verificar', async () => {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });

    const error = await clienteCon(fetchImpl, 20)
      .existe(TRIP_ID)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 503, code: 'SUPPORT_TRIP_SERVICE_UNAVAILABLE' });
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), { tripId: TRIP_ID, motivo: 'sin respuesta en 20 ms' });
  });

  it('conserva el error original como cause, fuera del mensaje', async () => {
    const original = new TypeError('connect ECONNREFUSED 10.0.0.6:3000');
    const error = (await clienteCon(async () => {
      throw original;
    })
      .existe(TRIP_ID)
      .catch((e: unknown) => e)) as SupportError;

    expect(error.cause).toBe(original);
    expect(error.message).not.toContain('ECONNREFUSED');
  });
});

describe('createM6TripsClient: isReachable', () => {
  it('true si GET /health de M6 responde 2xx', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respuesta(200, { status: 'ok' }));

    expect(await clienteCon(fetchImpl).isReachable()).toBe(true);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE_URL}/health`);
  });

  it('false si responde un error', async () => {
    expect(await clienteCon(async () => respuesta(503)).isReachable()).toBe(false);
  });

  it('false si no se puede conectar, sin lanzar', async () => {
    const cliente = clienteCon(async () => {
      throw new TypeError('fetch failed');
    });

    expect(await cliente.isReachable()).toBe(false);
  });
});

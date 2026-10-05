import { describe, it, expect, beforeEach, vi } from 'vitest';
import { solicitarViaje, asignarConductor, registrarArribo } from '../../src/controllers/viajes.controller.js';
import { mockRequest, mockResponse } from '../datos-prueba/mocks.js';
import pool from '../../src/db/pool.js';

vi.mock('../../src/services/redis.service.js', () => ({
  redisClient: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    on: vi.fn()
  }
}));
vi.mock('../../src/services/rabbitmq.service.js', () => ({
  publicarEvento: vi.fn().mockResolvedValue(true)
}));
vi.mock('../../src/services/conductor.service', () => ({
  consultarEstadoConductor: vi.fn(async () => ({
    conductorId: 'mock',
    habilitado: true,
  })),
}));

vi.mock('../../src/services/qr.service.js', () => {
  const codigos = new Map<string, string>();
  let generation = 0;
  class M8ApiError extends Error {
    constructor(readonly status: number, readonly code: string, readonly retryAfter?: string) {
      super(code);
    }
  }

  return {
    M8ApiError,
    generarQR: vi.fn(async (tripId: string) => {
      const token = `TEST-${tripId}-${++generation}`;
      codigos.set(tripId, token);
      return { token, qrDataUrl: 'data:image/png;base64,test', expiresAt: new Date(Date.now() + 300_000).toISOString() };
    }),
    validarQR: vi.fn(async (tripId: string, codigo: string) => {
      return codigos.get(tripId) === codigo
        ? { valid: true }
        : { valid: false };
    }),
  };
});

describe('Registrar Arribo del Conductor', () => {

  beforeEach(async () => {
    await pool.query('TRUNCATE viajes RESTART IDENTITY CASCADE;');
  });

  it('debe cambiar estado a ARRIBADO cuando el conductor llega', async () => {
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;

    const req2 = mockRequest({ conductorId: 'conductor-1' }, { id: viajeId });
    const res2 = mockResponse();
    await asignarConductor(req2 as any, res2 as any);

    const req3 = mockRequest({}, { id: viajeId });
    const res3 = mockResponse();
    await registrarArribo(req3 as any, res3 as any);

    expect(res3.statusCode).toBe(200);
    expect(res3.data.viaje.estado).toBe('ARRIBADO');
    expect(res3.data.qr.token).toBeDefined();
    expect(res3.data.qr.expiresAt).toBeDefined();
    const qrService = await import('../../src/services/qr.service.js');
    expect(qrService.generarQR).toHaveBeenCalledTimes(1);

    const conductorService = await import('../../src/services/conductor.service.js');
    const rabbitService = await import('../../src/services/rabbitmq.service.js');
    vi.mocked(conductorService.consultarEstadoConductor).mockClear();
    vi.mocked(rabbitService.publicarEvento).mockClear();

    const retry = mockResponse();
    await registrarArribo(req3 as any, retry as any);

    expect(retry.statusCode).toBe(200);
    expect(retry.data.qr.token).toBe(res3.data.qr.token);
    expect(qrService.generarQR).toHaveBeenCalledTimes(1);
    expect(conductorService.consultarEstadoConductor).not.toHaveBeenCalled();
    expect(rabbitService.publicarEvento).not.toHaveBeenCalled();
  });

  it('recupera el QR tras perderse la respuesta de M8 sin repetir M3 ni el evento', async () => {
    const created = mockResponse();
    await solicitarViaje(
      mockRequest({ clienteId: 'cliente-retry', origen: 'A', destino: 'B' }) as any,
      created as any
    );
    const viajeId = created.data.id;
    await asignarConductor(mockRequest({ conductorId: 'conductor-retry' }, { id: viajeId }) as any, mockResponse() as any);

    const qrService = await import('../../src/services/qr.service.js');
    const conductorService = await import('../../src/services/conductor.service.js');
    const rabbitService = await import('../../src/services/rabbitmq.service.js');
    const tokenRecuperado = 'QR_RECUPERADO_DESPUES_DE_TIMEOUT';
    const qrRecuperado = {
      token: tokenRecuperado,
      qrDataUrl: 'data:image/png;base64,recovered',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
    vi.mocked(qrService.generarQR)
      .mockRejectedValueOnce(new qrService.M8ApiError(503, 'M8_UNAVAILABLE', '2'))
      .mockResolvedValueOnce(qrRecuperado);
    vi.mocked(conductorService.consultarEstadoConductor).mockClear();
    vi.mocked(rabbitService.publicarEvento).mockClear();

    const firstAttempt = mockResponse();
    await registrarArribo(mockRequest({}, { id: viajeId }) as any, firstAttempt as any);
    expect(firstAttempt.statusCode).toBe(503);
    expect(firstAttempt.headers['Retry-After']).toBe('2');

    const { rows: stateAfterFailure } = await pool.query('SELECT estado FROM viajes WHERE id = $1', [viajeId]);
    expect(stateAfterFailure[0].estado).toBe('ARRIBADO');

    const retry = mockResponse();
    await registrarArribo(mockRequest({}, { id: viajeId }) as any, retry as any);

    expect(retry.statusCode).toBe(200);
    expect(retry.data.qr).toEqual(qrRecuperado);
    expect(conductorService.consultarEstadoConductor).toHaveBeenCalledTimes(1);
    expect(rabbitService.publicarEvento).toHaveBeenCalledTimes(1);
  });

  it('debe rechazar si no está en estado CONDUCTOR_EN_CAMINO', async () => {
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;

    const req2 = mockRequest({}, { id: viajeId });
    const res2 = mockResponse();
    await registrarArribo(req2 as any, res2 as any);

    expect(res2.statusCode).toBe(400);
    expect(res2.data.error).toContain('Transición inválida');
  });

  it('debe retornar 404 si el viaje no existe', async () => {
    const req = mockRequest({}, { id: 'viaje-inexistente' });
    const res = mockResponse();
    await registrarArribo(req as any, res as any);

    expect(res.statusCode).toBe(404);
    expect(res.data.error).toBe('Viaje no encontrado');
  });

  it('debe incluir mensaje de confirmación', async () => {
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;

    const req2 = mockRequest({ conductorId: 'conductor-1' }, { id: viajeId });
    const res2 = mockResponse();
    await asignarConductor(req2 as any, res2 as any);

    const req3 = mockRequest({}, { id: viajeId });
    const res3 = mockResponse();
    await registrarArribo(req3 as any, res3 as any);

    expect(res3.data.mensaje).toBeDefined();
    expect(res3.data.mensaje).toMatch(/llegado|arribado/i);
  });
});
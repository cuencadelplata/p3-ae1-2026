import { describe, it, expect, beforeEach, vi } from 'vitest';
import { solicitarViaje, asignarConductor, registrarArribo, iniciarViaje } from '../../src/controllers/viajes.controller.js';
import { mockRequest, mockResponse } from '../datos-prueba/mocks.js';
import pool from '../../src/db/pool.js';

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
  class M8ApiError extends Error {
    constructor(readonly status: number, readonly code: string, readonly retryAfter?: string) {
      super(code);
    }
  }

  return {
    M8ApiError,
    generarQR: vi.fn(async (tripId: string) => {
      const token = `TEST-${tripId}`;
      codigos.set(tripId, token);
      return { token, qrDataUrl: 'data:image/png;base64,test', expiresAt: new Date().toISOString() };
    }),
    validarQR: vi.fn(async (tripId: string, token: string) => {
      return codigos.get(tripId) === token
        ? { valid: true }
        : { valid: false };
    }),
  };
});

describe('RF-6.3: Inicio Validado - Validacion con QR', () => {
  beforeEach(async () => {
    await pool.query('TRUNCATE viajes RESTART IDENTITY CASCADE;');
  });

  it('debe cambiar estado a EN_CURSO si el codigo es valido', async () => {
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;
    const codigoValido = res1.data.codigoVerificacion;

    const req2 = mockRequest({ conductorId: 'conductor-1' }, { id: viajeId });
    const res2 = mockResponse();
    await asignarConductor(req2 as any, res2 as any);

    const req3 = mockRequest({}, { id: viajeId });
    const res3 = mockResponse();
    await registrarArribo(req3 as any, res3 as any);

    const req4 = mockRequest({ codigoVerificacion: codigoValido }, { id: viajeId });
    const res4 = mockResponse();
    await iniciarViaje(req4 as any, res4 as any);

    expect(res4.statusCode).toBe(200);
    expect(res4.data.viaje.estado).toBe('EN_CURSO');
  });

  it('debe rechazar si el codigo de verificacion es inválido', async () => {
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

    const req4 = mockRequest({ codigoVerificacion: 'CODIGO_INVALIDO' }, { id: viajeId });
    const res4 = mockResponse();
    await iniciarViaje(req4 as any, res4 as any);

    expect(res4.statusCode).toBe(401);
  });

  it('debe rechazar si el viaje no está en estado ARRIBADO', async () => {
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;
    const codigoValido = res1.data.codigoVerificacion;

    const req2 = mockRequest({ codigoVerificacion: codigoValido }, { id: viajeId });
    const res2 = mockResponse();
    await iniciarViaje(req2 as any, res2 as any);

    expect(res2.statusCode).toBe(400);
    expect(res2.data.error).toContain('No puedes iniciar');
  });

  it('debe retornar 404 si el viaje no existe', async () => {
    const req = mockRequest(
      { codigoVerificacion: 'ABC123' },
      { id: 'viaje-inexistente' }
    );
    const res = mockResponse();
    await iniciarViaje(req as any, res as any);

    expect(res.statusCode).toBe(404);
    expect(res.data.error).toBe('Viaje no encontrado');
  });

  it('debe validar codigo de forma case-sensitive', async () => {
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;
    const codigoValido = res1.data.codigoVerificacion;

    const req2 = mockRequest({ conductorId: 'conductor-1' }, { id: viajeId });
    const res2 = mockResponse();
    await asignarConductor(req2 as any, res2 as any);

    const req3 = mockRequest({}, { id: viajeId });
    const res3 = mockResponse();
    await registrarArribo(req3 as any, res3 as any);

    const codigoIncorrecto = codigoValido.toLowerCase();
    const req4 = mockRequest({ codigoVerificacion: codigoIncorrecto }, { id: viajeId });
    const res4 = mockResponse();
    await iniciarViaje(req4 as any, res4 as any);

    expect(res4.statusCode).toBe(401);
  });
  it('debe retornar 503 si el servicio externo M8 está caído o tarda demasiado (RNF-14)', async () => {
    // 1. Setup normal del viaje hasta el estado ARRIBADO
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;
    const codigoValido = res1.data.codigoVerificacion;

    await asignarConductor(mockRequest({ conductorId: 'conductor-1' }, { id: viajeId }) as any, mockResponse() as any);
    await registrarArribo(mockRequest({}, { id: viajeId }) as any, mockResponse() as any);

    // 2. Importamos el servicio mockeado y forzamos el error de caída SOLO para este test
    const qrService = await import('../../src/services/qr.service.js');
    vi.mocked(qrService.validarQR).mockRejectedValueOnce(
      new qrService.M8ApiError(503, 'M8_UNAVAILABLE', '3')
    );

    // 3. El conductor intenta iniciar el viaje con su app
    const req4 = mockRequest({ codigoVerificacion: codigoValido }, { id: viajeId });
    const res4 = mockResponse();
    
    // 4. Ejecutamos el controlador
    await iniciarViaje(req4 as any, res4 as any);

    // 5. Validamos que el controlador capture el error y responda 503 de forma resiliente
    expect(res4.statusCode).toBe(503);
    expect(res4.data.viaje).toBeUndefined();
    expect(res4.headers['Retry-After']).toBe('3');
  });

  it('no inicia el viaje si M8 devuelve una validación negativa', async () => {
    const req1 = mockRequest({ clienteId: 'cliente-1', origen: 'A', destino: 'B' });
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;
    const token = res1.data.codigoVerificacion;
    await asignarConductor(mockRequest({ conductorId: 'conductor-1' }, { id: viajeId }) as any, mockResponse() as any);
    await registrarArribo(mockRequest({}, { id: viajeId }) as any, mockResponse() as any);

    const qrService = await import('../../src/services/qr.service.js');
    vi.mocked(qrService.validarQR).mockResolvedValueOnce({ valid: false });
    const response = mockResponse();
    await iniciarViaje(mockRequest({ token }, { id: viajeId }) as any, response as any);

    expect(response.statusCode).toBe(401);
    const { rows } = await pool.query('SELECT estado FROM viajes WHERE id = $1', [viajeId]);
    expect(rows[0].estado).toBe('ARRIBADO');
  });

  it('propaga los rechazos de M8 sin cambiar el estado del viaje', async () => {
    const req1 = mockRequest({ clienteId: 'cliente-1', origen: 'A', destino: 'B' });
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;
    const token = res1.data.codigoVerificacion;
    await asignarConductor(mockRequest({ conductorId: 'conductor-1' }, { id: viajeId }) as any, mockResponse() as any);
    await registrarArribo(mockRequest({}, { id: viajeId }) as any, mockResponse() as any);

    const qrService = await import('../../src/services/qr.service.js');
    vi.mocked(qrService.validarQR).mockRejectedValueOnce(
      new qrService.M8ApiError(410, 'QR_EXPIRED')
    );
    const response = mockResponse();
    await iniciarViaje(mockRequest({ token }, { id: viajeId }) as any, response as any);

    expect(response.statusCode).toBe(410);
    expect(response.data.error.code).toBe('QR_EXPIRED');
    const { rows } = await pool.query('SELECT estado FROM viajes WHERE id = $1', [viajeId]);
    expect(rows[0].estado).toBe('ARRIBADO');
  });

});
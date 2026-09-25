import { describe, it, expect, beforeEach, vi } from 'vitest';
import { solicitarViaje, asignarConductor, registrarArribo, iniciarViaje } from '../../src/controllers/viajes.controller.js';
import { mockRequest, mockResponse } from '../datos-prueba/mocks.js';
import pool from '../../src/db/pool.js';

vi.mock('../../src/services/qr.service.js', () => {
  const codigos = new Map<string, string>();
  return {
    generarQR: vi.fn(async (tripId: string) => {
      const codigo = `TEST-${tripId}`;
      codigos.set(tripId, codigo);
      return { codigo };
    }),
    validarQR: vi.fn(async (tripId: string, codigo: string) => {
      return codigos.get(tripId) === codigo
        ? { valido: true }
        : { valido: false, motivo: 'QR inválido' };
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
});
import { describe, it, expect, beforeEach } from 'vitest';
import { solicitarViaje, asignarConductor, registrarArribo, resetViajesDb } from '../../src/controllers/viajes.controller.js';
import { mockRequest, mockResponse } from '../fixtures/mocks.js';

describe('RF-6.2: Arribo del Conductor', () => {
  beforeEach(() => {
    resetViajesDb();
  });

  it('debe cambiar estado a ARRIBADO cuando el conductor confirma arribo', () => {
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;

    const req2 = mockRequest({ conductorId: 'conductor-1' }, { id: viajeId });
    const res2 = mockResponse();
    asignarConductor(req2 as any, res2 as any);

    const req3 = mockRequest({}, { id: viajeId });
    const res3 = mockResponse();
    registrarArribo(req3 as any, res3 as any);

    expect(res3.statusCode).toBe(200);
    expect(res3.data.viaje.estado).toBe('ARRIBADO');
  });

  it('debe rechazar si el viaje no existe', () => {
    const req = mockRequest({}, { id: 'inexistente' });
    const res = mockResponse();
    registrarArribo(req as any, res as any);

    expect(res.statusCode).toBe(404);
    expect(res.data.error).toBe('Viaje no encontrado');
  });

  it('debe rechazar si el viaje no está en estado CONDUCTOR_EN_CAMINO', () => {
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;

    const req2 = mockRequest({}, { id: viajeId });
    const res2 = mockResponse();
    registrarArribo(req2 as any, res2 as any);

    expect(res2.statusCode).toBe(400);
  });

  it('debe retornar mensaje de confirmación de arribo', () => {
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;

    const req2 = mockRequest({ conductorId: 'conductor-1' }, { id: viajeId });
    const res2 = mockResponse();
    asignarConductor(req2 as any, res2 as any);

    const req3 = mockRequest({}, { id: viajeId });
    const res3 = mockResponse();
    registrarArribo(req3 as any, res3 as any);

    expect(res3.data.mensaje).toBeDefined();
    expect(res3.data.mensaje).toMatch(/llegado|arribado/i);
  });
});
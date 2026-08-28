import { describe, it, expect, beforeEach } from 'vitest';
import { solicitarViaje, asignarConductor, registrarArribo, resetViajesDb } from '../../src/controllers/viajes.controller.js';
import { mockRequest, mockResponse } from '../fixtures/mocks.js';

describe('Registrar Arribo del Conductor', () => {
  
  beforeEach(() => {
    resetViajesDb();
  });

  it('debe cambiar estado a ARRIBADO cuando el conductor llega', () => {
    // Crear viaje
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;

    // Asignar conductor
    const req2 = mockRequest({ conductorId: 'conductor-1' }, { id: viajeId });
    const res2 = mockResponse();
    asignarConductor(req2 as any, res2 as any);

    // Registrar arribo
    const req3 = mockRequest({}, { id: viajeId });
    const res3 = mockResponse();
    registrarArribo(req3 as any, res3 as any);

    expect(res3.statusCode).toBe(200);
    expect(res3.data.viaje.estado).toBe('ARRIBADO');
  });

  it('debe rechazar si no está en estado CONDUCTOR_EN_CAMINO', () => {
    // Crear viaje
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;

    // Intentar registrar arribo sin asignar (viaje sigue en SOLICITADO)
    const req2 = mockRequest({}, { id: viajeId });
    const res2 = mockResponse();
    registrarArribo(req2 as any, res2 as any);

    expect(res2.statusCode).toBe(400);
    expect(res2.data.error).toContain('Transición inválida');
  });

  it('debe retornar 404 si el viaje no existe', () => {
    const req = mockRequest({}, { id: 'viaje-inexistente' });
    const res = mockResponse();
    registrarArribo(req as any, res as any);

    expect(res.statusCode).toBe(404);
    expect(res.data.error).toBe('Viaje no encontrado');
  });

  it('debe incluir mensaje de confirmación', () => {
    // Crear viaje
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;

    // Asignar conductor
    const req2 = mockRequest({ conductorId: 'conductor-1' }, { id: viajeId });
    const res2 = mockResponse();
    asignarConductor(req2 as any, res2 as any);

    // Registrar arribo
    const req3 = mockRequest({}, { id: viajeId });
    const res3 = mockResponse();
    registrarArribo(req3 as any, res3 as any);

    expect(res3.data.mensaje).toBeDefined();
    expect(res3.data.mensaje).toMatch(/llegado|arribado/i);
  });
});

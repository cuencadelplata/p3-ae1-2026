import { describe, it, expect, beforeEach } from 'vitest';
import { solicitarViaje, asignarConductor, registrarArribo, iniciarViaje, resetViajesDb } from '../../src/controllers/viajes.controller.js';
import { mockRequest, mockResponse } from '../fixtures/mocks.js';

describe('Ciclo Completo del Viaje', () => {
  
  beforeEach(() => {
    resetViajesDb();
  });

  it('debe completar el flujo: Solicitar → Asignar → Arribo → Iniciar', async () => {
    // 1. Solicitar viaje
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);

    expect(res1.statusCode).toBe(201);
    expect(res1.data.estado).toBe('SOLICITADO');
    
    const viajeId = res1.data.id;
    const codigoValido = res1.data.codigoVerificacion;

    // 2. Asignar conductor
    const req2 = mockRequest({ conductorId: 'conductor-1' }, { id: viajeId });
    const res2 = mockResponse();
    asignarConductor(req2 as any, res2 as any);

    expect(res2.statusCode).toBe(200);
    expect(res2.data.viaje.estado).toBe('CONDUCTOR_EN_CAMINO');

    // 3. Registrar arribo
    const req3 = mockRequest({}, { id: viajeId });
    const res3 = mockResponse();
    registrarArribo(req3 as any, res3 as any);

    expect(res3.statusCode).toBe(200);
    expect(res3.data.viaje.estado).toBe('ARRIBADO');

    // 4. Iniciar viaje
    const req4 = mockRequest({ codigoVerificacion: codigoValido }, { id: viajeId });
    const res4 = mockResponse();
    iniciarViaje(req4 as any, res4 as any);

    expect(res4.statusCode).toBe(200);
    expect(res4.data.viaje.estado).toBe('EN_CURSO');
  });

  it('debe mantener datos del cliente a lo largo del ciclo', async () => {
    const clienteId = 'cliente-premium-123';
    const origen = 'Avenida Principal 100';
    const destino = 'Centro Comercial';

    // 1. Solicitar viaje
    const req1 = mockRequest({
      clienteId,
      origen,
      destino,
    });
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;
    const codigoValido = res1.data.codigoVerificacion;

    // 2. Asignar conductor
    const req2 = mockRequest({ conductorId: 'conductor-1' }, { id: viajeId });
    const res2 = mockResponse();
    asignarConductor(req2 as any, res2 as any);

    // Verificar que los datos se mantienen
    expect(res2.data.viaje.clienteId).toBe(clienteId);
    expect(res2.data.viaje.origen).toBe(origen);
    expect(res2.data.viaje.destino).toBe(destino);

    // 3. Registrar arribo
    const req3 = mockRequest({}, { id: viajeId });
    const res3 = mockResponse();
    registrarArribo(req3 as any, res3 as any);

    // Verificar que los datos se mantienen
    expect(res3.data.viaje.clienteId).toBe(clienteId);
    expect(res3.data.viaje.codigoVerificacion).toBe(codigoValido);

    // 4. Iniciar viaje
    const req4 = mockRequest({ codigoVerificacion: codigoValido }, { id: viajeId });
    const res4 = mockResponse();
    iniciarViaje(req4 as any, res4 as any);

    // Verificar que los datos se mantienen hasta el final
    expect(res4.data.viaje.clienteId).toBe(clienteId);
    expect(res4.data.viaje.conductorId).toBe('conductor-1');
  });

  it('debe rechazar cualquier paso fuera de secuencia', async () => {
    // 1. Solicitar viaje
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;
    const codigoValido = res1.data.codigoVerificacion;

    // Intentar iniciar sin asignar conductor ni registrar arribo
    const req2 = mockRequest({ codigoVerificacion: codigoValido }, { id: viajeId });
    const res2 = mockResponse();
    iniciarViaje(req2 as any, res2 as any);

    // Debe fallar
    expect(res2.statusCode).toBe(400);
  });

  it('debe permitir múltiples viajes simultáneamente', async () => {
    // Viaje 1
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);
    const viajeId1 = res1.data.id;

    // Pequeña pausa para que Date.now() sea diferente
    const startTime = Date.now();
    while (Date.now() - startTime < 2) {} // Espera 2ms

    // Viaje 2
    const req2 = mockRequest({
      clienteId: 'cliente-2',
      origen: 'Calle 3',
      destino: 'Calle 4',
    });
    const res2 = mockResponse();
    await solicitarViaje(req2 as any, res2 as any);
    const viajeId2 = res2.data.id;

    // Asignar conductor a viaje 1
    const req3 = mockRequest({ conductorId: 'conductor-1' }, { id: viajeId1 });
    const res3 = mockResponse();
    asignarConductor(req3 as any, res3 as any);

    // Asignar conductor diferente a viaje 2
    const req4 = mockRequest({ conductorId: 'conductor-2' }, { id: viajeId2 });
    const res4 = mockResponse();
    asignarConductor(req4 as any, res4 as any);

    // Verificar que ambas asignaciones fueron exitosas
    expect(res3.statusCode).toBe(200);
    expect(res4.statusCode).toBe(200);
    expect(res3.data.viaje.conductorId).toBe('conductor-1');
    expect(res4.data.viaje.conductorId).toBe('conductor-2');
  });
});

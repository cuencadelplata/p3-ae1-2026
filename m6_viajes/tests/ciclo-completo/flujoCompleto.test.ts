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

describe('Ciclo Completo del Viaje', () => {

  beforeEach(async () => {
    await pool.query('TRUNCATE viajes RESTART IDENTITY CASCADE;');
  });

  it('debe completar el flujo: Solicitar → Asignar → Arribo → Iniciar', async () => {
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

    const req2 = mockRequest({ conductorId: 'conductor-1' }, { id: viajeId });
    const res2 = mockResponse();
    await asignarConductor(req2 as any, res2 as any);

    expect(res2.statusCode).toBe(200);
    expect(res2.data.viaje.estado).toBe('CONDUCTOR_EN_CAMINO');

    const req3 = mockRequest({}, { id: viajeId });
    const res3 = mockResponse();
    await registrarArribo(req3 as any, res3 as any);

    expect(res3.statusCode).toBe(200);
    expect(res3.data.viaje.estado).toBe('ARRIBADO');

    const req4 = mockRequest({ codigoVerificacion: codigoValido }, { id: viajeId });
    const res4 = mockResponse();
    await iniciarViaje(req4 as any, res4 as any);

    expect(res4.statusCode).toBe(200);
    expect(res4.data.viaje.estado).toBe('EN_CURSO');
  });

  it('debe mantener datos del cliente a lo largo del ciclo', async () => {
    const clienteId = 'cliente-premium-123';
    const origen = 'Avenida Principal 100';
    const destino = 'Centro Comercial';

    const req1 = mockRequest({ clienteId, origen, destino });
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);
    const viajeId = res1.data.id;
    const codigoValido = res1.data.codigoVerificacion;

    const req2 = mockRequest({ conductorId: 'conductor-1' }, { id: viajeId });
    const res2 = mockResponse();
    await asignarConductor(req2 as any, res2 as any);

    expect(res2.data.viaje.clienteId).toBe(clienteId);
    expect(res2.data.viaje.origen).toBe(origen);
    expect(res2.data.viaje.destino).toBe(destino);

    const req3 = mockRequest({}, { id: viajeId });
    const res3 = mockResponse();
    await registrarArribo(req3 as any, res3 as any);

    expect(res3.data.viaje.clienteId).toBe(clienteId);
    expect(res3.data.viaje.codigoVerificacion).toBe(codigoValido);

    const req4 = mockRequest({ codigoVerificacion: codigoValido }, { id: viajeId });
    const res4 = mockResponse();
    await iniciarViaje(req4 as any, res4 as any);

    expect(res4.data.viaje.clienteId).toBe(clienteId);
    expect(res4.data.viaje.conductorId).toBe('conductor-1');
  });

  it('debe rechazar cualquier paso fuera de secuencia', async () => {
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
  });

  it('debe permitir múltiples viajes simultáneamente', async () => {
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);
    const viajeId1 = res1.data.id;

    const startTime = Date.now();
    while (Date.now() - startTime < 2) {}

    const req2 = mockRequest({
      clienteId: 'cliente-2',
      origen: 'Calle 3',
      destino: 'Calle 4',
    });
    const res2 = mockResponse();
    await solicitarViaje(req2 as any, res2 as any);
    const viajeId2 = res2.data.id;

    const req3 = mockRequest({ conductorId: 'conductor-1' }, { id: viajeId1 });
    const res3 = mockResponse();
    await asignarConductor(req3 as any, res3 as any);

    const req4 = mockRequest({ conductorId: 'conductor-2' }, { id: viajeId2 });
    const res4 = mockResponse();
    await asignarConductor(req4 as any, res4 as any);

    expect(res3.statusCode).toBe(200);
    expect(res4.statusCode).toBe(200);
    expect(res3.data.viaje.conductorId).toBe('conductor-1');
    expect(res4.data.viaje.conductorId).toBe('conductor-2');
  });
});
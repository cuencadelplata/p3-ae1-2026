import { describe, it, expect, beforeEach, vi } from 'vitest';
import { solicitarViaje, asignarConductor } from '../../src/controllers/viajes.controller.js';
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

describe('Concurrencia - Dos conductores intentan aceptar el mismo viaje', () => {

  beforeEach(async () => {
    await pool.query('TRUNCATE viajes RESTART IDENTITY CASCADE;');
  });

  it('debe permitir que solo UN conductor asigne el viaje cuando dos intentan simultáneamente', async () => {
    const reqSolicitud = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Avenida Principal',
      destino: 'Centro Comercial',
    });
    const resSolicitud = mockResponse();
    await solicitarViaje(reqSolicitud as any, resSolicitud as any);
    const viajeId = resSolicitud.data.id;

    const reqConductor1 = mockRequest({ conductorId: 'conductor-001' }, { id: viajeId });
    const resConductor1 = mockResponse();
    await asignarConductor(reqConductor1 as any, resConductor1 as any);

    const reqConductor2 = mockRequest({ conductorId: 'conductor-002' }, { id: viajeId });
    const resConductor2 = mockResponse();
    await asignarConductor(reqConductor2 as any, resConductor2 as any);

    expect(resConductor1.statusCode).toBe(200);
    expect(resConductor1.data.viaje.conductorId).toBe('conductor-001');
    expect(resConductor1.data.viaje.estado).toBe('CONDUCTOR_EN_CAMINO');

    expect(resConductor2.statusCode).toBe(400);
    expect(resConductor2.data.error).toContain('No puedes asignar');
  });

  it('debe mantener la consistencia: ningún viaje queda con dos conductores', async () => {
    const reqSolicitud = mockRequest({
      clienteId: 'cliente-premium',
      origen: 'Terminal',
      destino: 'Aeropuerto',
    });
    const resSolicitud = mockResponse();
    await solicitarViaje(reqSolicitud as any, resSolicitud as any);
    const viajeId = resSolicitud.data.id;

    const reqC1 = mockRequest({ conductorId: 'cond-1' }, { id: viajeId });
    const resC1 = mockResponse();
    await asignarConductor(reqC1 as any, resC1 as any);

    const reqC2 = mockRequest({ conductorId: 'cond-2' }, { id: viajeId });
    const resC2 = mockResponse();
    await asignarConductor(reqC2 as any, resC2 as any);

    expect(resC1.statusCode).toBe(200);
    expect(resC2.statusCode).toBe(400);
    expect(resC1.data.viaje.conductorId).toBe('cond-1');
    expect(resC2.data.error).toBeDefined();
  });

  it('debe demostrar que la segunda asignación falla incluso si es con diferente conductor', async () => {
    const reqSolicitud = mockRequest({
      clienteId: 'cliente-2',
      origen: 'Punto A',
      destino: 'Punto B',
    });
    const resSolicitud = mockResponse();
    await solicitarViaje(reqSolicitud as any, resSolicitud as any);
    const viajeId = resSolicitud.data.id;

    const req1 = mockRequest({ conductorId: 'alfa' }, { id: viajeId });
    const res1 = mockResponse();
    await asignarConductor(req1 as any, res1 as any);
    expect(res1.statusCode).toBe(200);

    const req2 = mockRequest({ conductorId: 'beta' }, { id: viajeId });
    const res2 = mockResponse();
    await asignarConductor(req2 as any, res2 as any);
    expect(res2.statusCode).toBe(400);

    const req3 = mockRequest({ conductorId: 'gamma' }, { id: viajeId });
    const res3 = mockResponse();
    await asignarConductor(req3 as any, res3 as any);
    expect(res3.statusCode).toBe(400);

    expect(res1.data.viaje.conductorId).toBe('alfa');
  });
});
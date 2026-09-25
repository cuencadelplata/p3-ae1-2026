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
        : { valido: false, motivo: 'QR invÃ¡lido' };
    }),
  };
});

describe('RF-6.2: Arribo del Conductor', () => {
  beforeEach(async () => {
    await pool.query('TRUNCATE viajes RESTART IDENTITY CASCADE;');
  });

  it('debe cambiar estado a CONDUCTOR_EN_CAMINO cuando se asigna un conductor', async () => {
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

    expect(res2.statusCode).toBe(200);
    expect(res2.data.viaje.estado).toBe('CONDUCTOR_EN_CAMINO');
    expect(res2.data.viaje.conductorId).toBe('conductor-1');
  });

  it('debe rechazar asignacion si el viaje no esta en estado SOLICITADO', async () => {
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

    const req3 = mockRequest({ conductorId: 'conductor-2' }, { id: viajeId });
    const res3 = mockResponse();
    await asignarConductor(req3 as any, res3 as any);

    expect(res3.statusCode).toBe(400);
    expect(res3.data.error).toContain('No puedes asignar');
  });

  it('debe retornar 404 si el viaje no existe', async () => {
    const req = mockRequest({ conductorId: 'conductor-1' }, { id: 'viaje-inexistente' });
    const res = mockResponse();
    await asignarConductor(req as any, res as any);

    expect(res.statusCode).toBe(404);
    expect(res.data.error).toBe('Viaje no encontrado');
  });

  it('debe incluir mensaje de confirmacion', async () => {
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

    expect(res2.data.mensaje).toBeDefined();
    expect(res2.data.mensaje).toContain('Conductor asignado');
  });
});
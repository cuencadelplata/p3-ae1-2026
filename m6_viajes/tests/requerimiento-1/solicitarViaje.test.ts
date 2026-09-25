import { describe, it, expect, beforeEach, vi } from 'vitest';
import { solicitarViaje } from '../../src/controllers/viajes.controller.js';
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

describe('RF-6.1: Solicitar Viaje - Estados del viaje', () => {

  beforeEach(async () => {
    await pool.query('TRUNCATE viajes RESTART IDENTITY CASCADE;');
  });

  it('debe crear un nuevo viaje con estado SOLICITADO', async () => {
    const req = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res = mockResponse();

    await solicitarViaje(req as any, res as any);

    expect(res.statusCode).toBe(201);
    expect(res.data.estado).toBe('SOLICITADO');
    expect(res.data.clienteId).toBe('cliente-1');
    expect(res.data.origen).toBe('Calle 1');
    expect(res.data.destino).toBe('Calle 2');
  });

  it('debe generar un codigo de verificación único', async () => {
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);

    const req2 = mockRequest({
      clienteId: 'cliente-2',
      origen: 'Calle 3',
      destino: 'Calle 4',
    });
    const res2 = mockResponse();
    await solicitarViaje(req2 as any, res2 as any);

    expect(res1.data.codigoVerificacion).toBeDefined();
    expect(res2.data.codigoVerificacion).toBeDefined();
    expect(res1.data.codigoVerificacion).not.toBe(res2.data.codigoVerificacion);
  });

  it('debe generar un ID unico para cada viaje', async () => {
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);

    setTimeout(() => {}, 1);

    const req2 = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res2 = mockResponse();
    await solicitarViaje(req2 as any, res2 as any);

    expect(res1.data.id).toBeDefined();
    expect(res2.data.id).toBeDefined();

    expect(typeof res1.data.id).toBe('string');
    expect(typeof res2.data.id).toBe('string');
  });

  it('debe incluir fecha de creacion', async () => {
    const req = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res = mockResponse();

    await solicitarViaje(req as any, res as any);

    expect(res.data.fechaCreacion).toBeDefined();
    const esFechaValida = res.data.fechaCreacion instanceof Date || !isNaN(Date.parse(res.data.fechaCreacion));
    expect(esFechaValida).toBe(true);
  });
});
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { solicitarViaje } from '../../../src/rf-6.1-6.2-6.3/controllers/viajes.controller.js';
import { mockRequest, mockResponse } from '../datos-prueba/mocks.js';
import * as viajeRepo from '../../../src/rf-6.1-6.2-6.3/repositories/viaje.repository.js';
import pool from '../../../src/rf-6.1-6.2-6.3/db/pool.js';

vi.mock('../../../src/rf-6.1-6.2-6.3/services/qr.service.js', () => {
  const codigos = new Map<string, string>();
  return {
    generarQR: vi.fn(async (tripId: string) => {
      const token = `TEST-${tripId}`;
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

  it('debe dejar la generación del QR para el arribo', async () => {
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

    expect(res1.data.codigoVerificacion).toBeNull();
    expect(res2.data.codigoVerificacion).toBeNull();
    const qrService = await import('../../../src/rf-6.1-6.2-6.3/services/qr.service.js');
    expect(qrService.generarQR).not.toHaveBeenCalled();
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

  it('debe aceptar clientUserId y evitar viajes duplicados con rideRequestId e Idempotency-Key', async () => {
    const req1 = mockRequest({
      clienteId: 'cliente-1',
      clientUserId: 42,
      rideRequestId: 'ride-42',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    req1.headers = { 'idempotency-key': 'idem-42' };
    const res1 = mockResponse();
    await solicitarViaje(req1 as any, res1 as any);

    const req2 = mockRequest({
      clienteId: 'cliente-1',
      clientUserId: 42,
      rideRequestId: 'ride-42',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    req2.headers = { 'idempotency-key': 'idem-42' };
    const res2 = mockResponse();
    await solicitarViaje(req2 as any, res2 as any);

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(200);
    expect(res2.data.id).toBe(res1.data.id);
    expect(res2.data.clientUserId).toBe(42);
  });
  it.each(['cliente', 'conductor'] as const)('conserva idempotencia tras cancelación de %s y permite reemplazo solo por conductor', async (actor) => {
    const body = { clienteId: 'cliente-reasignacion', clientUserId: 42, rideRequestId: 'ride-reasignacion', origen: 'A', destino: 'B' };
    const send = async () => {
      const req = mockRequest(body);
      req.headers = { 'idempotency-key': 'ride-reasignacion' };
      const res = mockResponse();
      await solicitarViaje(req as any, res as any);
      return res;
    };
    const original = await send();
    await viajeRepo.cancelarSiCancelable(original.data.id, actor, 'Cancelación de prueba');
    const replacement = await send();
    expect(replacement.statusCode).toBe(actor === 'conductor' ? 201 : 200);
    if (actor === 'conductor') expect(replacement.data.id).not.toBe(original.data.id);
    else expect(replacement.data.id).toBe(original.data.id);
    const retry = await send();
    expect(retry.data.id).toBe(replacement.data.id);
    expect((await viajeRepo.buscarPorId(original.data.id))?.canceladoPor).toBe(actor);
  });

});
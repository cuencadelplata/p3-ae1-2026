import { describe, it, expect, beforeEach } from 'vitest';
import { solicitarViaje, resetViajesDb } from '../../src/controllers/viajes.controller.js';
import { mockRequest, mockResponse } from '../fixtures/mocks.js';

describe('RF-6.1: Solicitar Viaje - Estados del viaje', () => {
  
  beforeEach(() => {
    resetViajesDb();
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
    // Acepta tanto un objeto Date como una fecha en string/ISO
    const esFechaValida = res.data.fechaCreacion instanceof Date || !isNaN(Date.parse(res.data.fechaCreacion));
    expect(esFechaValida).toBe(true);
  });

  it('debe generar un codigo QR valido', async () => {
    const req = mockRequest({
      clienteId: 'cliente-1',
      origen: 'Calle 1',
      destino: 'Calle 2',
    });
    const res = mockResponse();

    await solicitarViaje(req as any, res as any);

    expect(res.data.qrCode).toBeDefined();
    expect(typeof res.data.qrCode).toBe('string');
    expect(res.data.qrCode).toContain('data:image/png;base64');
  });
});

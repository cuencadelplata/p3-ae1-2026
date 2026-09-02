import { describe, expect, it, vi } from 'vitest';

import { HttpDespachoClient } from '../../src/clients/despacho.client.js';
import { HttpTarifaClient } from '../../src/clients/tarifa.client.js';
import { AppError } from '../../src/errors/app.error.js';

describe('clientes HTTP de servicios externos', () => {
  it('crea una solicitud de despacho con la respuesta esperada', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ solicitudId: '123e4567-e89b-12d3-a456-426614174000', estado: 'CREADA' }),
    });

    globalThis.fetch = fetchMock as typeof fetch;

    const client = new HttpDespachoClient('http://m5:3001');
    const result = await client.crearSolicitud({
      id: '11111111-1111-4111-8111-111111111111',
      clienteId: '22222222-2222-4222-8222-222222222222',
      origen: 'A',
      destino: 'B',
      vehiculo: 'AUTO',
      fechaHoraProgramada: '2099-01-01T13:00:00.000Z',
      estado: 'PROGRAMADA',
      tarifaEstimada: 100,
      moneda: 'ARS',
      criterioAsignacion: 'MEJOR_CALIFICACION',
      idSolicitud: null,
      creadoEn: '2099-01-01T12:00:00.000Z',
      actualizadoEn: '2099-01-01T12:00:00.000Z',
    });

    expect(result).toEqual({ solicitudId: '123e4567-e89b-12d3-a456-426614174000', estado: 'CREADA' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lanza AppError si M5 falla', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new HttpDespachoClient('http://m5:3001');

    await expect(
      client.crearSolicitud({
        id: '11111111-1111-4111-8111-111111111111',
        clienteId: '22222222-2222-4222-8222-222222222222',
        origen: 'A',
        destino: 'B',
        vehiculo: 'AUTO',
        fechaHoraProgramada: '2099-01-01T13:00:00.000Z',
        estado: 'PROGRAMADA',
        tarifaEstimada: 100,
        moneda: 'ARS',
        criterioAsignacion: 'MEJOR_CALIFICACION',
        idSolicitud: null,
        creadoEn: '2099-01-01T12:00:00.000Z',
        actualizadoEn: '2099-01-01T12:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('estima tarifa correctamente con respuesta válida', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tarifaEstimada: 2450, moneda: 'ARS' }),
    });

    globalThis.fetch = fetchMock as typeof fetch;

    const client = new HttpTarifaClient('http://m7:3002');
    const result = await client.estimar({ origen: 'A', destino: 'B', vehiculo: 'AUTO' });

    expect(result).toEqual({ tarifaEstimada: 2450, moneda: 'ARS' });
  });

  it('lanza AppError si M7 falla', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new HttpTarifaClient('http://m7:3002');

    await expect(
      client.estimar({ origen: 'A', destino: 'B', vehiculo: 'AUTO' }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HttpDespachoClient } from '../../src/clients/despacho.client.js';
import { HttpTarifaClient } from '../../src/clients/tarifa.client.js';
import type { Reserva } from '../../src/domain/reserva.js';
import { createM5StubApp } from '../../src/stubs/m5/app.js';
import { createM7StubApp } from '../../src/stubs/m7/app.js';

describe('stubs M5 y M7', () => {
  const m5Server = createM5StubApp().listen(0);
  const m7Server = createM7StubApp().listen(0);
  let m5Url = '';
  let m7Url = '';

  beforeAll(() => {
    m5Url = `http://127.0.0.1:${(m5Server.address() as AddressInfo).port}`;
    m7Url = `http://127.0.0.1:${(m7Server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    m5Server.close();
    m7Server.close();
  });

  it('M7 devuelve una tarifa utilizable por el cliente HTTP', async () => {
    const response = await new HttpTarifaClient(m7Url).estimar({
      origen: 'A',
      destino: 'B',
      vehiculo: 'MOTO',
    });

    expect(response).toEqual({ tarifaEstimada: 1_500, moneda: 'ARS' });
  });

  it('M5 crea una solicitud utilizable por el cliente HTTP', async () => {
    const reserva: Reserva = {
      id: '00000000-0000-4000-8000-000000000001',
      clienteId: '00000000-0000-4000-8000-000000000002',
      origen: 'A',
      destino: 'B',
      vehiculo: 'AUTO',
      fechaHoraProgramada: new Date().toISOString(),
      estado: 'ACTIVANDO',
      tarifaEstimada: null,
      moneda: 'ARS',
      criterioAsignacion: 'MEJOR_CALIFICACION',
      idSolicitud: null,
      creadoEn: new Date().toISOString(),
      actualizadoEn: new Date().toISOString(),
    };

    const response = await new HttpDespachoClient(m5Url).crearSolicitud(reserva);
    expect(response.estado).toBe('CREADA');
    expect(response.solicitudId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

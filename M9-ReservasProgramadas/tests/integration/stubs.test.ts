import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  EnvironmentTokenProvider,
  InMemoryDispatchOperationStore,
  M5DispatchClient,
} from '../../src/clients/m5-dispatch.client.js';
import { M7TariffClient } from '../../src/clients/m7-tariff.client.js';
import { createM5StubApp } from '../../src/stubs/m5/app.js';
import { createM7StubApp } from '../../src/stubs/m7/app.js';
import { routeSnapshot } from '../helpers/route.js';

describe('dobles locales compatibles con M5 y M7', () => {
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

  it('M7 responde a POST /tarifa/estimacion con el DTO real', async () => {
    const response = await new M7TariffClient(m7Url, 1_000).estimar({
      vehiculo: 'MOTO',
      route: routeSnapshot,
    });
    expect(response).toMatchObject({
      moneda: 'ARS',
      distanciaKm: 10,
      tiempoEstimadoMin: 20,
      estimacionId: expect.any(String),
    });
  });

  it('M5 crea, consulta y cancela usando Bearer e idempotencia', async () => {
    const client = new M5DispatchClient(
      m5Url,
      1_000,
      new EnvironmentTokenProvider('test-token'),
      new InMemoryDispatchOperationStore(),
    );
    const created = await client.createRequest({
      reserva: { id: crypto.randomUUID(), clienteId: crypto.randomUUID(), vehiculo: 'AUTO' },
      origin: routeSnapshot.origin,
      destination: routeSnapshot.destination,
    });
    expect(created).toMatchObject({ status: 'SEARCHING', requestId: expect.any(String) });
    await expect(
      client.cancelRequest(created.requestId, 'Cambio de planes'),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
  });
});

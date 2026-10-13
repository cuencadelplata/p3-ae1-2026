import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  EnvironmentTokenProvider,
  InMemoryDispatchOperationStore,
  M5DispatchClient,
} from '../../src/clients/m5-dispatch.client.js';
import { InMemoryReservaRepository } from '../../src/repositories/in-memory-reserva.repository.js';
import { ActivacionReservaService } from '../../src/services/activacion-reserva.service.js';
import { ReservaService } from '../../src/services/reserva.service.js';
import { createM5StubApp } from '../../src/stubs/m5/app.js';
import { createM5StubState, M5StubDispatchService } from '../../src/stubs/m5/dispatch.js';
import { fareEstimate, routeResolverDemo, routeSnapshot } from '../helpers/route.js';

describe('flujo M9 → M5 con contrato OpenAPI', () => {
  let server: Server;
  let client: M5DispatchClient;
  let repository: InMemoryReservaRepository;
  let m5Url: string;

  beforeEach(async () => {
    server = await new Promise<Server>((resolve) => {
      const started = createM5StubApp().listen(0, () => resolve(started));
    });
    m5Url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    client = new M5DispatchClient(
      m5Url,
      1_000,
      new EnvironmentTokenProvider('test-token'),
      new InMemoryDispatchOperationStore(),
    );
    repository = new InMemoryReservaRepository();
  });

  afterEach(
    async () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );

  it('ofrece por valoración, avanza tras rechazo y activa únicamente después de aceptar', async () => {
    const reservations = new ReservaService(
      repository,
      { estimar: async () => fareEstimate() },
      routeResolverDemo(),
    );
    const created = await reservations.crear({
      clienteId: randomUUID(),
      origen: 'A',
      destino: 'B',
      vehiculo: 'AUTO',
      fechaHoraProgramada: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(created).toMatchObject({
      estado: 'PROGRAMADA',
      idSolicitud: null,
      assignedDriverId: null,
    });
    await repository.actualizarProgramada(created.id, {
      fechaHoraProgramada: new Date(Date.now() - 1_000).toISOString(),
      routeSnapshot,
    });
    const activation = new ActivacionReservaService(repository, client, routeResolverDemo());
    await expect(activation.activar(created.id)).resolves.toMatchObject({ activada: false });
    expect(await repository.obtenerPorId(created.id)).toMatchObject({
      estado: 'ACTIVANDO',
      assignedDriverId: null,
    });

    const requestId = (await repository.obtenerPorId(created.id))!.idSolicitud!;
    const candidates = await m5Request<{
      candidates: Array<{ driverId: string; rating: number }>;
    }>(m5Url, `/api/v1/ride-requests/${requestId}/candidates`, { method: 'POST' });
    expect(candidates.candidates.map(({ rating }) => rating)).toEqual([4.9, 4.7, 4.5]);

    const sent = await m5Request<{
      offers: Array<{ id: string; driverId: string }>;
    }>(m5Url, `/api/v1/ride-requests/${requestId}/offers`, { method: 'POST' });
    expect(sent.offers).toHaveLength(1);
    expect(sent.offers[0]?.driverId).toBe(candidates.candidates[0]?.driverId);

    await m5Request(m5Url, `/api/v1/offers/${sent.offers[0]!.id}/reject`, {
      method: 'POST',
    });
    const afterReject = await m5Request<{
      offers: Array<{ id: string; driverId: string; status: string }>;
    }>(m5Url, `/api/v1/ride-requests/${requestId}/offers`);
    const nextOffer = afterReject.offers.find(({ status }) => status === 'PENDING');
    expect(nextOffer?.driverId).toBe(candidates.candidates[1]?.driverId);
    await m5Request(m5Url, `/api/v1/offers/${nextOffer!.id}/accept`, { method: 'POST' });

    await expect(activation.activar(created.id)).resolves.toMatchObject({ activada: true });
    expect(await repository.obtenerPorId(created.id)).toMatchObject({
      estado: 'ACTIVADA',
      assignedDriverId: candidates.candidates[1]?.driverId,
      criterioAsignacion: 'MEJOR_VALORACION',
    });
  });

  it('cancela en M5 una reserva ACTIVANDO y conserva la consistencia local', async () => {
    const created = await vencida(repository);
    const activation = new ActivacionReservaService(repository, client, routeResolverDemo());
    await activation.activar(created.id);
    const reservations = new ReservaService(
      repository,
      { estimar: async () => fareEstimate() },
      routeResolverDemo(),
      undefined,
      undefined,
      client,
    );
    await expect(reservations.cancelar(created.id)).resolves.toMatchObject({ estado: 'CANCELADA' });
  });

  it('permite un solo ganador ante dos aceptaciones concurrentes', async () => {
    const created = await client.createRequest({
      reserva: { id: randomUUID(), clienteId: randomUUID(), vehiculo: 'AUTO' },
      origin: routeSnapshot.origin,
      destination: routeSnapshot.destination,
    });
    const sent = await m5Request<{ offers: Array<{ id: string }> }>(
      m5Url,
      `/api/v1/ride-requests/${created.requestId}/offers`,
      { method: 'POST' },
    );
    const offerId = sent.offers[0]!.id;
    const responses = await Promise.all([
      m5RawRequest(m5Url, `/api/v1/offers/${offerId}/accept`, { method: 'POST' }),
      m5RawRequest(m5Url, `/api/v1/offers/${offerId}/accept`, { method: 'POST' }),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    await expect(client.getRequest(created.requestId)).resolves.toMatchObject({
      status: 'ASSIGNED',
      assignedDriverId: '30000000-0000-4000-8000-000000000001',
    });
  });

  it('vence la oferta y avanza automáticamente al siguiente candidato', async () => {
    let current = new Date('2026-10-13T12:00:00.000Z');
    const dispatch = new M5StubDispatchService(
      createM5StubState(),
      async () => undefined,
      () => current,
    );
    const ride = dispatch.createRequest(
      {
        origin: routeSnapshot.origin,
        destination: routeSnapshot.destination,
        vehicleType: 'AUTO',
      },
      randomUUID(),
    );
    const [first] = await dispatch.sendOffers(ride.id, { ttlSeconds: 5 });
    current = new Date(current.getTime() + 6_000);
    await expect(dispatch.respondToOffer(first!.id, 'ACCEPT')).rejects.toMatchObject({
      code: 'OFFER_EXPIRED',
    });
    expect(dispatch.getOffer(first!.id).status).toBe('EXPIRED');
    expect(dispatch.getOffers(ride.id).find(({ status }) => status === 'PENDING')).toMatchObject({
      driverId: '30000000-0000-4000-8000-000000000002',
    });
  });

  it('rechaza cancelar mientras el despacho asíncrono aún no tiene requestId', async () => {
    const created = await vencida(repository);
    await repository.cambiarEstado(created.id, 'PROGRAMADA', 'ACTIVANDO', {
      routeSnapshot,
    });
    const reservations = new ReservaService(
      repository,
      { estimar: async () => fareEstimate() },
      routeResolverDemo(),
      undefined,
      undefined,
      client,
    );

    await expect(reservations.cancelar(created.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'RESERVA_EN_PROCESO',
    });
    expect(await repository.obtenerPorId(created.id)).toMatchObject({ estado: 'ACTIVANDO' });
  });
});

const vencida = (repository: InMemoryReservaRepository) =>
  repository.crear({
    clienteId: randomUUID(),
    origen: 'A',
    destino: 'B',
    vehiculo: 'AUTO',
    fechaHoraProgramada: new Date(Date.now() - 1_000).toISOString(),
    routeSnapshot,
  });

const m5Request = async <T = unknown>(baseUrl: string, path: string, init: RequestInit = {}) => {
  const response = await m5RawRequest(baseUrl, path, init);
  const body = (await response.json()) as T;
  if (!response.ok) throw new Error(`M5 HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
};

const m5RawRequest = (baseUrl: string, path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
      ...init.headers,
    },
    body: init.method === 'POST' && init.body === undefined ? '{}' : init.body,
  });

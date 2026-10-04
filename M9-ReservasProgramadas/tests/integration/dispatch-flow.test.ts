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
import { fareEstimate, routeResolverDemo, routeSnapshot } from '../helpers/route.js';

describe('flujo M9 → M5 con contrato OpenAPI', () => {
  let server: Server;
  let client: M5DispatchClient;
  let repository: InMemoryReservaRepository;

  beforeEach(async () => {
    server = await new Promise<Server>((resolve) => {
      const started = createM5StubApp().listen(0, () => resolve(started));
    });
    client = new M5DispatchClient(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
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

  it('no llama M5 al programar y activa únicamente después de ASSIGNED', async () => {
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
    await expect(activation.activar(created.id)).resolves.toMatchObject({ activada: true });
    expect(await repository.obtenerPorId(created.id)).toMatchObject({
      estado: 'ACTIVADA',
      assignedDriverId: expect.any(String),
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

import { describe, expect, it } from 'vitest';

import type { Reserva } from '../../src/domain/reserva.js';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3909';
const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = (await response.json()) as T;
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
};
const create = (suffix: string, delayMs = 600_000) =>
  requestJson<Reserva>('/reservas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clienteId: crypto.randomUUID(),
      origen: `Origen ${suffix}`,
      destino: `Destino ${suffix}`,
      vehiculo: 'AUTO',
      fechaHoraProgramada: new Date(Date.now() + delayMs).toISOString(),
    }),
  });
const waitForActivated = async (id: string): Promise<Reserva> => {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const reserva = await requestJson<Reserva>(`/reservas/${id}`);
    if (reserva.estado === 'ACTIVADA') return reserva;
    if (reserva.estado === 'FALLIDA') throw new Error('La reserva terminó FALLIDA.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('La reserva no llegó a ACTIVADA dentro del plazo.');
};

describe('E2E local contra contenedores', () => {
  it('sirve UI, OpenAPI y ejecuta CRUD con M7', async () => {
    expect(await (await fetch(`${baseUrl}/`)).text()).toContain('M9 Reservas');
    expect((await fetch(`${baseUrl}/openapi.json`)).status).toBe(200);
    const creada = await create('CRUD');
    expect(creada).toMatchObject({
      estado: 'PROGRAMADA',
      moneda: 'ARS',
      tarifaEstimada: expect.any(Number),
      estimacionTarifaId: expect.any(String),
      assignedDriverId: null,
      idSolicitud: null,
      routeSnapshot: { distanceKm: 18.4, estimatedDurationMin: 28 },
    });
    expect((await requestJson<Reserva>(`/reservas/${creada.id}`)).id).toBe(creada.id);
    const actualizada = await requestJson<Reserva>(`/reservas/${creada.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destino: 'Destino actualizado', vehiculo: 'MOTO' }),
    });
    expect(actualizada).toMatchObject({
      destino: 'Destino actualizado',
      vehiculo: 'MOTO',
      assignedDriverId: null,
    });
    expect(
      (await requestJson<Reserva>(`/reservas/${creada.id}`, { method: 'DELETE' })).estado,
    ).toBe('CANCELADA');
  });

  it('no crea solicitudes M5 ni asigna chofer mientras permanece PROGRAMADA', async () => {
    const reservas = await Promise.all([
      create('futura A'),
      create('futura B'),
      create('futura C'),
    ]);
    expect(reservas.every((reserva) => reserva.estado === 'PROGRAMADA')).toBe(true);
    expect(
      reservas.every(
        (reserva) => reserva.idSolicitud === null && reserva.assignedDriverId === null,
      ),
    ).toBe(true);
    await Promise.all(
      reservas.map((reserva) => requestJson(`/reservas/${reserva.id}`, { method: 'DELETE' })),
    );
  });

  it('activa al horario mediante M5 y guarda requestId/assignedDriverId', async () => {
    const creada = await create('Scheduler', 6_000);
    expect(creada).toMatchObject({
      estado: 'PROGRAMADA',
      idSolicitud: null,
      assignedDriverId: null,
    });
    const activada = await waitForActivated(creada.id);
    expect(activada).toMatchObject({
      estado: 'ACTIVADA',
      idSolicitud: expect.stringMatching(/^[0-9a-f-]{36}$/),
      assignedDriverId: expect.any(String),
    });
  }, 30_000);
});

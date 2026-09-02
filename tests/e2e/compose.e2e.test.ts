import { describe, expect, it } from 'vitest';

import type { Reserva } from '../../src/domain/reserva.js';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3909';

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
};

const waitForActivated = async (id: string): Promise<Reserva> => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const reserva = await requestJson<Reserva>(`/reservas/${id}`);
    if (reserva.estado === 'ACTIVADA') return reserva;
    if (reserva.estado === 'FALLIDA') throw new Error('La reserva terminó FALLIDA durante el E2E.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('La reserva no llegó a ACTIVADA dentro de 20 segundos.');
};

describe('E2E local contra contenedores', () => {
  it('sirve la UI y ejecuta el CRUD completo con M7', async () => {
    const ui = await fetch(`${baseUrl}/`);
    expect(ui.status).toBe(200);
    expect(await ui.text()).toContain('M9 Reservas');

    const creada = await requestJson<Reserva>('/reservas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clienteId: crypto.randomUUID(),
        origen: 'Origen E2E CRUD',
        destino: 'Destino E2E CRUD',
        vehiculo: 'AUTO',
        fechaHoraProgramada: new Date(Date.now() + 600_000).toISOString(),
      }),
    });
    expect(creada).toMatchObject({ estado: 'PROGRAMADA', tarifaEstimada: 2_500, moneda: 'ARS' });

    expect((await requestJson<Reserva>(`/reservas/${creada.id}`)).id).toBe(creada.id);
    expect((await requestJson<{ reservas: Reserva[] }>('/reservas')).reservas).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: creada.id })]),
    );

    const actualizada = await requestJson<Reserva>(`/reservas/${creada.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destino: 'Destino E2E actualizado' }),
    });
    expect(actualizada.destino).toBe('Destino E2E actualizado');

    const cancelada = await requestJson<Reserva>(`/reservas/${creada.id}`, { method: 'DELETE' });
    expect(cancelada.estado).toBe('CANCELADA');
  });

  it('activa una reserva vencida mediante scheduler y M5', async () => {
    const creada = await requestJson<Reserva>('/reservas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clienteId: crypto.randomUUID(),
        origen: 'Origen E2E Scheduler',
        destino: 'Destino E2E Scheduler',
        vehiculo: 'MOTO',
        fechaHoraProgramada: new Date(Date.now() + 6_000).toISOString(),
      }),
    });
    const activada = await waitForActivated(creada.id);
    expect(activada.estado).toBe('ACTIVADA');
    expect(activada.idSolicitud).toMatch(/^[0-9a-f-]{36}$/);
    expect(activada.tarifaEstimada).toBe(1_500);
  }, 25_000);
});

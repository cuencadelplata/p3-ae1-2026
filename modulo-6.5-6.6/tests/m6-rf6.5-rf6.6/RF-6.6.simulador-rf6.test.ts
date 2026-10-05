import { describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createViajeApi, HttpRf6ApiClient } from '../../src/m6-rf6.5-rf6.6/api.js';
import { createRf6Simulator } from '../../simulator/m6-rf6.5-rf6.6/rf6-server.js';

 describe('RF-6.6 - Integración con simulador RF-6', () => {
  it('cancela un viaje asignado usando GET y PATCH del contrato RF-6', async () => {
    const rf6 = createRf6Simulator();
    const rf6Port = await listen(rf6);
    const messages: Array<{ routingKey: string; payload: unknown }> = [];
    const api = createViajeApi({
      rf6Api: new HttpRf6ApiClient(`http://127.0.0.1:${rf6Port}`),
      events: {
        async publish(routingKey, payload) {
          messages.push({ routingKey, payload });
        },
      },
    });
    const apiPort = await listen(api);

    try {
      const created = await fetch(`http://127.0.0.1:${rf6Port}/api/viajes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clienteId: 'cliente-sim', origen: 'Calle A', destino: 'Calle B' }),
      });
      const viaje = await created.json() as { id: string };
      expect(created.status).toBe(201);

      const assigned = await fetch(`http://127.0.0.1:${rf6Port}/api/viajes/${viaje.id}/asignar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conductorId: 'conductor-sim' }),
      });
      expect(assigned.status).toBe(200);

      const response = await fetch(`http://127.0.0.1:${apiPort}/api/viajes/${viaje.id}/cancelacion-conductor`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ motivo: 'Falla mecánica' }),
      });
      const body = await response.json() as { viaje: { estado: string; actorCancelacion?: string } };
      const persisted = await fetch(`http://127.0.0.1:${rf6Port}/api/viajes/${viaje.id}`);

      expect(response.status).toBe(200);
      expect(body.viaje).toMatchObject({ estado: 'CANCELADO', actorCancelacion: 'conductor' });
      expect(await persisted.json()).toMatchObject({ estado: 'CANCELADO', motivoCancelacion: 'Falla mecánica' });
      expect(messages[0]).toMatchObject({
        routingKey: 'despacho.reabrir',
        payload: { viajeId: viaje.id, clienteId: 'cliente-sim', conductorId: 'conductor-sim', evento: 'cancelacion_conductor' },
      });
    } finally {
      await close(api);
      await close(rf6);
    }
  });
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

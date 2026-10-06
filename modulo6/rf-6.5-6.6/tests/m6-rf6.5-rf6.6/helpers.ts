import type { Server } from 'node:http';
import { createViajeApi, type CancellationEventPublisher, type Rf6ApiClient, type Rf6Viaje } from '../../../src/rf-6.5-6.6/api.js';

export async function startServices(viajes: Map<string, Rf6Viaje>): Promise<{
  api: Server;
  url: string;
  events: TestEventPublisher;
}> {
  const rf6Api: Rf6ApiClient = {
    async getViaje(viajeId) {
      const viaje = viajes.get(viajeId);
      if (!viaje) throw new Error('Viaje no encontrado');
      return viaje;
    },
    async cancelViaje(input) {
      const viaje = viajes.get(input.viajeId);
      if (!viaje) throw new Error('Viaje no encontrado');
      const cancelado = { ...viaje, estado: 'CANCELADO' };
      viajes.set(input.viajeId, cancelado);
      return cancelado;
    },
  };
  const events = new TestEventPublisher();
  const api = createViajeApi({
    rf6Api,
    events,
  });
  const apiPort = await listen(api);
  return { api, events, url: `http://127.0.0.1:${apiPort}` };
}

export function stopServices(server: Server): void {
  server.close();
}

export class TestEventPublisher implements CancellationEventPublisher {
  readonly messages: Array<{ routingKey: string; payload: unknown }> = [];

  async publish(routingKey: string, payload: unknown): Promise<void> {
    this.messages.push({ routingKey, payload });
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
}
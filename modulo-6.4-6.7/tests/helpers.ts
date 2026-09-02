import type { Server } from 'node:http';
import { createViajeApi, HttpExternalApisClient } from '../src/api.js';
import { createSimulator } from '../simulator/server.js';
import type { Viaje } from '../src/Viaje.js';

export async function startServices(viajes: Map<string, Viaje>): Promise<{
  api: Server;
  simulator: Server;
  url: string;
}> {
  const simulator = createSimulator();
  const simulatorPort = await listen(simulator);
  const api = createViajeApi({
    externalApis: new HttpExternalApisClient(`http://127.0.0.1:${simulatorPort}`),
    viajes,
  });
  const apiPort = await listen(api);
  return { api, simulator, url: `http://127.0.0.1:${apiPort}` };
}

export function stopServices(...servers: Server[]): void {
  for (const server of servers) server.close();
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
}
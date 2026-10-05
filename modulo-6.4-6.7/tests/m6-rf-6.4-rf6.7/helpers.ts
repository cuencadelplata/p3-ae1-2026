import { createServer, type Server } from 'node:http';
import { createViajeApi, type ViajesApiClient } from '../../src/m6-rf-6.4-rf6.7/api.js';
import { createSimulator } from '../../simulator/m6-rf-6.4-rf6.7/server.js';

interface TestViaje {
  id: string;
  clienteId: string;
  estado: string;
  historial: Array<{ from: string; to: string; timestamp: string; detalle: string }>;
}

export class StubViajesApiClient implements ViajesApiClient {
  private nextId = 1;
  readonly viajes = new Map<string, TestViaje>();

  async crearViaje(input: { clienteId: string; origen: string; destino: string }) {
    const id = `CENTRAL-${this.nextId++}`;
    const viaje: TestViaje = {
      id,
      clienteId: input.clienteId,
      estado: 'SOLICITADO',
      historial: [],
    };
    this.viajes.set(id, viaje);
    return {
      status: 201,
      body: {
        id,
        clienteId: input.clienteId,
        estado: 'SOLICITADO',
        fechaCreacion: new Date().toISOString(),
        origen: input.origen,
        destino: input.destino,
      },
    };
  }

  async finalizarViaje(id: string, input: Record<string, unknown>) {
    const viaje = this.viajes.get(id);
    if (!viaje) return { status: 404, body: { error: 'Viaje no encontrado' } };
    if (viaje.estado !== 'EN_CURSO') {
      const error = viaje.estado === 'COMPLETADO'
        ? 'No se puede finalizar un viaje ya finalizado'
        : `No se puede finalizar un viaje en estado ${viaje.estado}`;
      return { status: 400, body: { error } };
    }

    viaje.estado = 'COMPLETADO';
    viaje.historial.push({
      from: 'en curso',
      to: 'completado',
      timestamp: new Date().toISOString(),
      detalle: 'Finalización del viaje',
    });
    return {
      status: 200,
      body: {
        viaje: {
          id,
          clienteId: viaje.clienteId,
          estado: 'completado',
          total: 927.5,
          tiempoMinutos: 3,
          distanciaKm: 1.11,
          metodoPago: input.metodoPago,
          metricasEstimadas: true,
        },
        paymentId: `PAY-${id}`,
        metricasEstimadas: true,
        fuenteMetrica: 'M4',
      },
    };
  }

  async obtenerHistorial(id: string) {
    const viaje = this.viajes.get(id);
    if (!viaje) return { status: 404, body: { error: 'Viaje no encontrado' } };
    return { status: 200, body: { historial: viaje.historial } };
  }

  cambiarEstado(id: string, estado: string): void {
    const viaje = this.viajes.get(id);
    if (!viaje) throw new Error(`Viaje de prueba ${id} no encontrado`);
    viaje.estado = estado;
  }

  agregarTransicion(id: string, from: string, to: string, detalle: string): void {
    const viaje = this.viajes.get(id);
    if (!viaje) throw new Error(`Viaje de prueba ${id} no encontrado`);
    viaje.historial.push({ from, to, timestamp: new Date().toISOString(), detalle });
  }
}

export async function startServices(viajesApi: ViajesApiClient = new StubViajesApiClient()): Promise<{
  api: Server;
  simulator: Server;
  url: string;
  viajesApi: ViajesApiClient;
}> {
  const simulator = createSimulator();
  await listen(simulator);
  const api = createViajeApi({ viajesApi });
  const apiPort = await listen(api);
  return { api, simulator, url: `http://127.0.0.1:${apiPort}`, viajesApi };
}

export function stopServices(...servers: Server[]): void {
  for (const server of servers) server.close();
}

export async function crearViaje(url: string, clienteId = 'cliente-test'): Promise<{ id: string; clienteId: string }> {
  const response = await fetch(`${url}/api/viajes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clienteId, origen: 'Calle A', destino: 'Calle B' }),
  });
  const body = await response.json() as { viaje?: { id: string; clienteId: string }; error?: string };
  if (response.status !== 201 || !body.viaje) {
    throw new Error(`No se pudo crear el viaje: ${response.status} ${body.error ?? ''}`);
  }
  return body.viaje;
}

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });
}

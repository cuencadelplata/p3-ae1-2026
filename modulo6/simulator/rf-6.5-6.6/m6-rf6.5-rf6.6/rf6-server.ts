import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface SimulatedViaje {
  id: string;
  clienteId: string;
  conductorId?: string;
  origen: string;
  destino: string;
  estado: 'SOLICITADO' | 'CONDUCTOR_EN_CAMINO' | 'CANCELADO';
  codigoVerificacion: string;
  qrCode: string;
  fechaCreacion: string;
  motivoCancelacion?: string;
  actorCancelacion?: 'cliente' | 'conductor';
}

export function createRf6Simulator(viajes = new Map<string, SimulatedViaje>()): Server {
  return createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (request.method === 'POST' && pathname === '/api/viajes') {
        const input = await readJson(request);
        if (!input.clienteId || !input.origen || !input.destino) {
          return send(response, 400, { error: 'clienteId, origen y destino son obligatorios' });
        }

        const id = `sim-${Date.now()}-${viajes.size + 1}`;
        const viaje: SimulatedViaje = {
          id,
          clienteId: String(input.clienteId),
          origen: String(input.origen),
          destino: String(input.destino),
          estado: 'SOLICITADO',
          codigoVerificacion: 'SIM123',
          qrCode: 'data:image/png;base64,c2ltdWxhZG9y',
          fechaCreacion: new Date().toISOString(),
        };
        viajes.set(id, viaje);
        return send(response, 201, viaje);
      }

      const match = pathname.match(/^\/api\/viajes\/([^/]+)(?:\/(asignar|cancelacion))?$/);
      if (!match) return send(response, 404, { error: 'Ruta no encontrada' });
      const viajeId = decodeURIComponent(match[1]);
      const accion = match[2];
      const viaje = viajes.get(viajeId);
      if (!viaje) return send(response, 404, { error: 'Viaje no encontrado' });

      if (request.method === 'GET' && !accion) return send(response, 200, viaje);

      if (request.method === 'POST' && accion === 'asignar') {
        const input = await readJson(request);
        if (viaje.estado !== 'SOLICITADO') {
          return send(response, 400, { error: `No se puede asignar un viaje en estado ${viaje.estado}` });
        }
        if (!input.conductorId) return send(response, 400, { error: 'conductorId es obligatorio' });
        viaje.conductorId = String(input.conductorId);
        viaje.estado = 'CONDUCTOR_EN_CAMINO';
        return send(response, 200, { mensaje: 'Conductor asignado', viaje });
      }

      if (request.method === 'PATCH' && accion === 'cancelacion') {
        const input = await readJson(request);
        if (!['cliente', 'conductor'].includes(String(input.actor)) || !String(input.motivo ?? '').trim()) {
          return send(response, 400, { error: 'actor y motivo de cancelación son obligatorios' });
        }
        if (!['SOLICITADO', 'CONDUCTOR_EN_CAMINO'].includes(viaje.estado)) {
          return send(response, 400, { error: `No se puede cancelar un viaje en estado ${viaje.estado}` });
        }
        viaje.estado = 'CANCELADO';
        viaje.actorCancelacion = input.actor as 'cliente' | 'conductor';
        viaje.motivoCancelacion = String(input.motivo).trim();
        return send(response, 200, viaje);
      }

      return send(response, 404, { error: 'Ruta no encontrada' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Solicitud inválida';
      return send(response, 400, { error: message });
    }
  });
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) as Record<string, unknown> : {};
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 3000);
  const server = createRf6Simulator();
  server.listen(port, '0.0.0.0', () => console.log(`Simulador RF-6 escuchando en ${port}`));
}

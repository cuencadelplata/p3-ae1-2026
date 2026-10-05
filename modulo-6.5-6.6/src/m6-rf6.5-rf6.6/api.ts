import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface Rf6Viaje {
  id: string | number;
  clienteId: string;
  conductorId?: string;
  estado: string;
  origen?: string;
  destino?: string;
}

export interface Rf6ApiClient {
  getViaje(viajeId: string): Promise<Rf6Viaje>;
  cancelViaje(input: { viajeId: string; actor: 'cliente' | 'conductor'; motivo: string }): Promise<Rf6Viaje>;
}

export class HttpRf6ApiClient implements Rf6ApiClient {
  constructor(private readonly baseUrl: string) {}

  async getViaje(viajeId: string): Promise<Rf6Viaje> {
    return this.request<Rf6Viaje>(`/api/viajes/${encodeURIComponent(viajeId)}`, { method: 'GET' });
  }

  async cancelViaje(input: { viajeId: string; actor: 'cliente' | 'conductor'; motivo: string }): Promise<Rf6Viaje> {
    return this.request<Rf6Viaje>(`/api/viajes/${encodeURIComponent(input.viajeId)}/cancelacion`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actor: input.actor, motivo: input.motivo }),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      const detail = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(detail.error ?? `API RF-6 respondió ${response.status}`);
    }
    return response.json() as Promise<T>;
  }
}

export interface CancellationEventPublisher {
  publish(routingKey: string, payload: unknown): Promise<void>;
}

export interface ViajeApiOptions {
  rf6Api: Rf6ApiClient;
  events: CancellationEventPublisher;
}

export function createViajeApi(options: ViajeApiOptions): Server {
  return createServer(async (request, response) => {
    try {
      const match = request.url?.match(/^\/api\/viajes\/([^/]+)\/(cancelacion-cliente|cancelacion-conductor)$/);
      if (!match) return send(response, 404, { error: 'Ruta no encontrada' });

      if (request.method !== 'POST') return send(response, 404, { error: 'Ruta no encontrada' });
      const input = await readJson(request) as { motivo?: string };
      const motivo = input.motivo?.trim() ?? '';
      if (!motivo) return send(response, 400, { error: 'El motivo de cancelación es obligatorio' });

      const actor = match[2] === 'cancelacion-cliente' ? 'cliente' : 'conductor';
      const viajeId = decodeURIComponent(match[1]);
      const viaje = await options.rf6Api.getViaje(viajeId);
      if (String(viaje.id) !== viajeId) {
        return send(response, 502, { error: 'RF-6 devolvió un ID distinto al solicitado' });
      }
      if (!['SOLICITADO', 'CONDUCTOR_EN_CAMINO'].includes(viaje.estado)) {
        return send(response, 400, { error: `No se puede cancelar un viaje en estado ${viaje.estado}` });
      }

      const viajeCancelado = await options.rf6Api.cancelViaje({ viajeId, actor, motivo });
      if (String(viajeCancelado.id) !== viajeId) {
        return send(response, 502, { error: 'RF-6 devolvió un ID distinto al cancelado' });
      }
      const routingKey = actor === 'conductor' ? 'despacho.reabrir' : 'cancelacion_cliente';
      await options.events.publish(routingKey, {
        viajeId: String(viajeCancelado.id),
        clienteId: viajeCancelado.clienteId,
        conductorId: viajeCancelado.conductorId,
        motivo,
        evento: actor === 'conductor' ? 'cancelacion_conductor' : routingKey,
        timestamp: new Date().toISOString(),
      });
      return send(response, 200, { viaje: viajeCancelado });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Solicitud inválida';
      const status = message.includes('Viaje no encontrado') ? 404 : 400;
      return send(response, status, { error: message });
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
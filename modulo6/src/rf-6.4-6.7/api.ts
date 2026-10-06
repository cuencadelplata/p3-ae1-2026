import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { BadGatewayError, ServiceUnavailableError } from './errors.js';

interface UpstreamResponse {
  status: number;
  body: unknown;
}

export interface ViajesApiClient {
  crearViaje(input: { clienteId: string; origen: string; destino: string }): Promise<UpstreamResponse>;
  finalizarViaje(id: string, input: Record<string, unknown>): Promise<UpstreamResponse>;
  obtenerHistorial(id: string): Promise<UpstreamResponse>;
}

export class HttpViajesApiClient implements ViajesApiClient {
  constructor(private readonly baseUrl: string) {}

  crearViaje(input: { clienteId: string; origen: string; destino: string }): Promise<UpstreamResponse> {
    return this.request('/api/viajes', 'POST', input);
  }

  finalizarViaje(id: string, input: Record<string, unknown>): Promise<UpstreamResponse> {
    return this.request(`/api/viajes/${encodeURIComponent(id)}/finalizacion`, 'POST', input);
  }

  obtenerHistorial(id: string): Promise<UpstreamResponse> {
    return this.request(`/api/viajes/${encodeURIComponent(id)}/historial-transiciones`, 'GET');
  }

  private async request(path: string, method: 'GET' | 'POST', input?: unknown): Promise<UpstreamResponse> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}${path}`, {
        method,
        headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
        body: method === 'POST' ? JSON.stringify(input) : undefined,
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      throw new ServiceUnavailableError(
        `No se pudo conectar con el módulo Viajes: ${error instanceof Error ? error.message : 'error de red'}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new BadGatewayError(`El módulo Viajes devolvió una respuesta JSON inválida (${response.status})`);
    }
    return { status: response.status, body };
  }
}

export interface ViajeApiOptions {
  viajesApi: ViajesApiClient;
}

export function createViajeApi(options: ViajeApiOptions): Server {
  return createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        return send(response, 200, { status: 'ok' });
      }

      if (request.method === 'POST' && request.url === '/api/viajes') {
        const input = await readJson(request);
        const { clienteId, origen, destino } = input;
        if (
          typeof clienteId !== 'string' || !clienteId.trim() ||
          typeof origen !== 'string' || !origen.trim() ||
          typeof destino !== 'string' || !destino.trim()
        ) {
          return send(response, 400, { error: 'clienteId, origen y destino son obligatorios' });
        }
        if (input.estado !== undefined && input.estado !== 'SOLICITADO' && input.estado !== 'solicitado') {
          return send(response, 400, {
            error: 'El estado inicial debe ser SOLICITADO; los cambios de estado pertenecen al módulo Viajes',
          });
        }

        const result = await options.viajesApi.crearViaje({
          clienteId: clienteId.trim(),
          origen: origen.trim(),
          destino: destino.trim(),
        });
        if (result.status < 200 || result.status >= 300) {
          return send(response, result.status, result.body);
        }

        const viaje = asRecord(result.body);
        if (
          typeof viaje.id !== 'string' ||
          typeof viaje.clienteId !== 'string' ||
          typeof viaje.estado !== 'string'
        ) {
          throw new BadGatewayError('El módulo Viajes devolvió datos incompletos al crear el viaje');
        }
        return send(response, result.status, {
          viaje: {
            id: viaje.id,
            clienteId: viaje.clienteId,
            conductorId: viaje.conductorId ?? null,
            estado: viaje.estado.toLowerCase(),
            inicio: viaje.fechaCreacion,
          },
        });
      }

      const match = request.url?.match(/^\/api\/viajes\/([^/]+)\/(finalizacion|historial-transiciones)$/);
      if (!match) return send(response, 404, { error: 'Ruta no encontrada' });

      const id = decodeURIComponent(match[1]);
      if (request.method === 'POST' && match[2] === 'finalizacion') {
        const input = await readJson(request);
        const result = await options.viajesApi.finalizarViaje(id, input);
        return send(response, result.status, result.body);
      }

      if (request.method === 'GET' && match[2] === 'historial-transiciones') {
        const result = await options.viajesApi.obtenerHistorial(id);
        return send(response, result.status, result.body);
      }

      return send(response, 404, { error: 'Ruta no encontrada' });
    } catch (error) {
      if (error instanceof ServiceUnavailableError) {
        console.error('ERROR conectando con el módulo Viajes:', error.message);
        return send(response, 503, { error: error.message });
      }
      if (error instanceof BadGatewayError) {
        console.error('ERROR en la respuesta del módulo Viajes:', error.message);
        return send(response, 502, { error: error.message });
      }
      if (error instanceof SyntaxError) {
        return send(response, 400, { error: 'El cuerpo debe contener JSON válido' });
      }
      console.error('ERROR procesando solicitud RF-6.4/6.7:', error);
      return send(response, 500, { error: 'Error interno del servidor' });
    }
  });
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of request) body += chunk;
  if (!body) return {};
  const parsed: unknown = JSON.parse(body);
  return asRecord(parsed);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SyntaxError('Se esperaba un objeto JSON');
  }
  return value as Record<string, any>;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { observarSolicitud, responderMetricas } from '../observabilidad/http.js';
import { asociarViaje, logger, requestIdActual } from '../observabilidad/logger.js';
import { BadGatewayError, ServiceUnavailableError } from './errors.js';

interface UpstreamResponse {
  status: number;
  body: unknown;
}

export interface ViajesApiClient {
  crearViaje(input: { clienteId: string; origen: string; destino: string }): Promise<UpstreamResponse>;
  finalizarViaje(id: string, input: Record<string, unknown>): Promise<UpstreamResponse>;
  obtenerHistorial(id: string): Promise<UpstreamResponse>;
  /** RF-6.7: registro de viajes filtrado (query ya saneada). */
  buscarViajes?(query: URLSearchParams): Promise<UpstreamResponse>;
}

/** Parámetros que la fachada reenvía al registro de viajes; el resto se descarta. */
export const FILTROS_REGISTRO = ['clienteId', 'conductorId', 'estado', 'limit', 'offset'] as const;

export class HttpViajesApiClient implements ViajesApiClient {
  constructor(private readonly baseUrl: string) {}

  crearViaje(input: { clienteId: string; origen: string; destino: string }): Promise<UpstreamResponse> {
    return this.request('/api/viajes', 'POST', input);
  }

  buscarViajes(query: URLSearchParams): Promise<UpstreamResponse> {
    const texto = query.toString();
    return this.request(`/api/viajes${texto ? `?${texto}` : ''}`, 'GET');
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
      const requestId = requestIdActual();
      response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}${path}`, {
        method,
        headers: {
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
          // Mismo X-Request-Id en la fachada y en Viajes para correlacionar logs.
          ...(requestId ? { 'x-request-id': requestId } : {}),
        },
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
  return createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    observarSolicitud(request, response, () => rutaParametrizada(pathname), () => {
      void atender(options, request, response, pathname);
    });
  });
}

/** Rutas sin ids, para que las métricas no creen una serie por viaje. */
function rutaParametrizada(pathname: string): string {
  if (pathname.startsWith('/api/viajes/')) {
    return pathname.replace(/^\/api\/viajes\/[^/]+/, '/api/viajes/:id');
  }
  if (['/', '/health', '/metrics', '/api/viajes'].includes(pathname) || ARCHIVOS_FRONT[pathname]) return pathname;
  return 'sin_ruta';
}

// Front de RF-6.4/6.7. Lista cerrada de archivos: no se sirve ninguna otra ruta del disco.
const ARCHIVOS_FRONT: Record<string, { archivo: string; tipo: string }> = {
  '/': { archivo: 'index.html', tipo: 'text/html; charset=utf-8' },
  '/registro.js': { archivo: 'registro.js', tipo: 'text/javascript; charset=utf-8' },
  '/registro.css': { archivo: 'registro.css', tipo: 'text/css; charset=utf-8' },
};
const DIRECTORIO_FRONT = resolve(process.env.FRONTEND_RF64_RF67_DIR ?? 'frontend-rf-6.4-6.7');

async function servirFront(response: ServerResponse, pathname: string): Promise<boolean> {
  const entrada = ARCHIVOS_FRONT[pathname];
  if (!entrada) return false;
  try {
    const contenido = await readFile(join(DIRECTORIO_FRONT, entrada.archivo));
    response.writeHead(200, {
      'content-type': entrada.tipo,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'",
    });
    response.end(contenido);
  } catch {
    send(response, 404, { error: 'Front no disponible' });
  }
  return true;
}

async function atender(
  options: ViajeApiOptions,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<void> {
    try {
      if (request.method === 'GET' && pathname === '/health') {
        return send(response, 200, { status: 'ok' });
      }

      if (request.method === 'GET' && pathname === '/metrics') {
        return responderMetricas(response);
      }

      if (request.method === 'GET' && await servirFront(response, pathname)) return;

      if (request.method === 'GET' && pathname === '/api/viajes') {
        if (!options.viajesApi.buscarViajes) return send(response, 501, { error: 'Búsqueda no disponible' });
        const recibidos = new URL(request.url ?? '/', 'http://localhost').searchParams;
        const query = new URLSearchParams();
        for (const nombre of FILTROS_REGISTRO) {
          const valor = recibidos.get(nombre);
          if (valor) query.set(nombre, valor);
        }
        const result = await options.viajesApi.buscarViajes(query);
        return send(response, result.status, result.body);
      }

      if (request.method === 'POST' && pathname === '/api/viajes') {
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

      const match = pathname.match(/^\/api\/viajes\/([^/]+)\/(finalizacion|historial-transiciones)$/);
      if (!match) return send(response, 404, { error: 'Ruta no encontrada' });

      const id = decodeURIComponent(match[1]);
      asociarViaje(id);
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
        logger.error({ causa: error.message }, 'No se pudo conectar con el módulo Viajes');
        return send(response, 503, { error: error.message });
      }
      if (error instanceof BadGatewayError) {
        logger.error({ causa: error.message }, 'Respuesta inválida del módulo Viajes');
        return send(response, 502, { error: error.message });
      }
      if (error instanceof SyntaxError) {
        return send(response, 400, { error: 'El cuerpo debe contener JSON válido' });
      }
      logger.error({ err: error }, 'Error procesando solicitud RF-6.4/6.7');
      return send(response, 500, { error: 'Error interno del servidor' });
    }
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

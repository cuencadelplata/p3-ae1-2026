import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Viaje, type CrearViajeInput, type FinalizarViajeInput } from './Viaje.js';

export interface ExternalApisClient {
  estimateFare(input: { viajeId: string; distanciaKm: number; tiempoMinutos: number }): Promise<number>;
  capturePayment(input: { viajeId: string; amount: number; metodoPago: string }): Promise<string>;
  cancellationCharge(input: { viajeId: string; estado: string }): Promise<number>;
  returnClientToDispatch(input: { viajeId: string; conductorId: string }): Promise<{ reabrirDespacho: boolean; clienteRetornado: boolean }>;
}

export class HttpExternalApisClient implements ExternalApisClient {
  constructor(private readonly baseUrl: string) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`API externa respondió ${response.status}`);
    return response.json() as Promise<T>;
  }

  async estimateFare(input: { viajeId: string; distanciaKm: number; tiempoMinutos: number }): Promise<number> {
    const result = await this.post<{ total: number }>('/api/tarifas/estimacion', input);
    return result.total;
  }

  async capturePayment(input: { viajeId: string; amount: number; metodoPago: string }): Promise<string> {
    const result = await this.post<{ paymentId: string }>('/api/pagos/captura', input);
    return result.paymentId;
  }

  async cancellationCharge(input: { viajeId: string; estado: string }): Promise<number> {
    const result = await this.post<{ cargo: number }>('/api/tarifas/cargo-cancelacion', input);
    return result.cargo;
  }

  async returnClientToDispatch(input: { viajeId: string; conductorId: string }): Promise<{ reabrirDespacho: boolean; clienteRetornado: boolean }> {
    const result = await this.post<{ reabrirDespacho: boolean; clienteRetornado: boolean }>('/api/despacho/reabrir', input);
    return result;
  }
}

export interface ViajeApiOptions {
  externalApis: ExternalApisClient;
  viajes?: Map<string, Viaje>;
}

export function createViajeApi(options: ViajeApiOptions): Server {
  const viajes = options.viajes ?? new Map<string, Viaje>();

  return createServer(async (request, response) => {
    try {
      const match = request.url?.match(/^\/api\/viajes\/([^/]+)\/(finalizacion|cancelacion-cliente|cancelacion-conductor|historial-transiciones)$/);
      if (!match) return send(response, 404, { error: 'Ruta no encontrada' });

      const viaje = viajes.get(match[1]);
      if (!viaje) return send(response, 404, { error: 'Viaje no encontrado' });

      if (request.method === 'GET' && match[2] === 'historial-transiciones') {
        return send(response, 200, { historial: viaje.historialTransiciones });
      }

      if (request.method !== 'POST') return send(response, 404, { error: 'Ruta no encontrada' });
      const input = await readJson(request);

      if (match[2] === 'finalizacion') {
        const data = input as Partial<FinalizarViajeInput>;
        const total = await options.externalApis.estimateFare({
          viajeId: viaje.id,
          distanciaKm: Number(data.distanciaKm),
          tiempoMinutos: Number(data.tiempoMinutos),
        });
        viaje.finalizar({
          tiempoMinutos: Number(data.tiempoMinutos),
          distanciaKm: Number(data.distanciaKm),
          horaFin: new Date(String(data.horaFin)),
          metodoPago: String(data.metodoPago),
          total,
        });
        const paymentId = await options.externalApis.capturePayment({
          viajeId: viaje.id,
          amount: total,
          metodoPago: viaje.metodoPago as string,
        });
        return send(response, 200, { viaje, paymentId });
      }

      if (match[2] === 'cancelacion-cliente') {
        const motivo = String((input as { motivo?: string }).motivo ?? '');
        const cargo = await options.externalApis.cancellationCharge({ viajeId: viaje.id, estado: viaje.estado });
        viaje.cancelarPorCliente({ motivo, cargo });
        return send(response, 200, { viaje });
      }

      const motivo = String((input as { motivo?: string }).motivo ?? '');
      const retornoDespacho = await options.externalApis.returnClientToDispatch({
        viajeId: viaje.id,
        conductorId: viaje.conductorId,
      });
      viaje.cancelarPorConductor({ motivo });
      viaje.retornoDespacho = retornoDespacho;
      return send(response, 200, { viaje, retornoDespacho });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Solicitud inválida';
      return send(response, 400, { error: message });
    }
  });
}

export function crearViaje(data: CrearViajeInput): Viaje {
  return new Viaje(data);
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
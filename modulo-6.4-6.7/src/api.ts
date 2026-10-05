import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import CircuitBreaker from 'opossum';
import {
  Viaje,
  type CoordenadasViaje,
  type CrearViajeInput,
  type TipoVehiculoViaje,
} from './Viaje.js';
import { MapViajeRepository, type ViajeRepository } from './ViajeRepository.js';
import { BadGatewayError, ExternalApiResponseError, ServiceUnavailableError } from './errors.js';

export interface ExternalApisClient {
  estimateDistance(input: {
    origen: CoordenadasViaje;
    destino: CoordenadasViaje;
  }): Promise<{ distanciaKm: number; tiempoEstimadoMin: number }>;
  estimateFare(input: {
    origen: CoordenadasViaje;
    destino: CoordenadasViaje;
    distanciaKm: number;
    tiempoEstimadoMin: number;
    tipoVehiculo: TipoVehiculoViaje;
  }): Promise<number>;
  registerPayment(input: { clienteId: string; viajeId: string; metodoPago: string }): Promise<string>;
  authorizePayment(viajeId: string): Promise<string>;
  cancellationCharge(input: { viajeId: string; estado: string }): Promise<number>;
  returnClientToDispatch(input: { viajeId: string; conductorId: string }): Promise<{ reabrirDespacho: boolean; clienteRetornado: boolean }>;
}

export class HttpExternalApisClient implements ExternalApisClient {
  private readonly breakers = new Map<string, CircuitBreaker<[unknown], unknown>>();

  constructor(
    private readonly m7BaseUrl: string,
    private readonly m4BaseUrl = `${m7BaseUrl}/api/v1`,
  ) {}

  private async post<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
    try {
      return await this.breaker(baseUrl, path).fire(body) as T;
    } catch (error) {
      if (error instanceof ExternalApiResponseError && error.status < 500) {
        throw new BadGatewayError(error.message);
      }
      throw new ServiceUnavailableError(`Dependencia externa no disponible: ${path}`);
    }
  }

  private breaker(baseUrl: string, path: string): CircuitBreaker<[unknown], unknown> {
    const key = `${baseUrl}${path}`;
    let breaker = this.breakers.get(key);
    if (!breaker) {
      breaker = new CircuitBreaker(
        (body: unknown) => this.send(baseUrl, path, body),
        {
          name: key,
          timeout: 2500,
          resetTimeout: 5000,
          errorThresholdPercentage: 50,
          volumeThreshold: 1,
          rollingCountTimeout: 10000,
          errorFilter: (error: unknown) => error instanceof ExternalApiResponseError && error.status < 500,
        },
      );
      this.breakers.set(key, breaker);
    }
    return breaker;
  }

  private async send(baseUrl: string, path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new ExternalApiResponseError(response.status);
    return response.json();
  }

  async estimateDistance(input: {
    origen: CoordenadasViaje;
    destino: CoordenadasViaje;
  }): Promise<{ distanciaKm: number; tiempoEstimadoMin: number }> {
    const result = await this.post<{ distanceKm?: number; estimatedEtaMinutes?: number }>(
      this.m4BaseUrl,
      '/estimate',
      {
        origin: { latitude: input.origen.latitude, longitude: input.origen.longitude },
        destination: { latitude: input.destino.latitude, longitude: input.destino.longitude },
      },
    );
    if (!isPositiveFiniteNumber(result.distanceKm) || !isPositiveFiniteNumber(result.estimatedEtaMinutes)) {
      throw new BadGatewayError('M4 devolvió una estimación de distancia o ETA inválida');
    }
    return { distanciaKm: result.distanceKm, tiempoEstimadoMin: result.estimatedEtaMinutes };
  }

  async estimateFare(input: {
    origen: CoordenadasViaje;
    destino: CoordenadasViaje;
    distanciaKm: number;
    tiempoEstimadoMin: number;
    tipoVehiculo: TipoVehiculoViaje;
  }): Promise<number> {
    const result = await this.post<{ estimatedFare?: number }>(this.m7BaseUrl, '/tarifa/estimacion', {
      origen: {
        lat: input.origen.latitude,
        lng: input.origen.longitude,
        direccion: input.origen.address ?? '',
      },
      destino: {
        lat: input.destino.latitude,
        lng: input.destino.longitude,
        direccion: input.destino.address ?? '',
      },
      distanciaKm: input.distanciaKm,
      tiempoEstimadoMin: input.tiempoEstimadoMin,
      vehicleType: input.tipoVehiculo,
    });
    if (!isFiniteNumber(result.estimatedFare) || result.estimatedFare < 0) {
      throw new BadGatewayError('M7 devolvió una tarifa estimada inválida');
    }
    return result.estimatedFare;
  }

  async registerPayment(input: { clienteId: string; viajeId: string; metodoPago: string }): Promise<string> {
    const result = await this.post<{ pagoId?: string; estado?: string }>(this.m7BaseUrl, '/metodo-pago', {
      clienteId: input.clienteId,
      viajeId: input.viajeId,
      tipo: input.metodoPago,
    });
    if (typeof result.pagoId !== 'string' || result.pagoId.length === 0 || result.estado !== 'pendiente') {
      throw new BadGatewayError('M7 devolvió una respuesta inválida al registrar el método de pago');
    }
    return result.pagoId;
  }

  async authorizePayment(viajeId: string): Promise<string> {
    const result = await this.post<{ pagoId?: string; estado?: string }>(
      this.m7BaseUrl,
      `/metodo-pago/${encodeURIComponent(viajeId)}/autorizar`,
      { idOrden: `ORD-${viajeId}` },
    );
    if (typeof result.pagoId !== 'string' || result.pagoId.length === 0 || result.estado !== 'autorizado') {
      throw new BadGatewayError('M7 no confirmó la autorización del pago');
    }
    return result.pagoId;
  }

  async cancellationCharge(input: { viajeId: string; estado: string }): Promise<number> {
    const result = await this.post<{ cargo: number }>(this.m7BaseUrl, '/api/tarifas/cargo-cancelacion', input);
    return result.cargo;
  }

  async returnClientToDispatch(input: { viajeId: string; conductorId: string }): Promise<{ reabrirDespacho: boolean; clienteRetornado: boolean }> {
    const result = await this.post<{ reabrirDespacho: boolean; clienteRetornado: boolean }>(
      this.m7BaseUrl,
      '/api/despacho/reabrir',
      input,
    );
    return result;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

export interface ViajeApiOptions {
  externalApis: ExternalApisClient;
  repository?: ViajeRepository;
  viajes?: Map<string, Viaje>;
}

export function createViajeApi(options: ViajeApiOptions): Server {
  const repository = options.repository ?? new MapViajeRepository(options.viajes);

  return createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        return send(response, 200, { status: 'ok' });
      }

      if (request.method === 'POST' && request.url === '/api/viajes') {
        const viaje = crearViaje(await readJson(request) as unknown as CrearViajeInput);
        await repository.save(viaje);
        return send(response, 201, { viaje });
      }

      const match = request.url?.match(/^\/api\/viajes\/([^/]+)\/(finalizacion|cancelacion-cliente|cancelacion-conductor|historial-transiciones)$/);
      if (!match) return send(response, 404, { error: 'Ruta no encontrada' });

      const viaje = await repository.get(match[1]);
      if (!viaje) return send(response, 404, { error: 'Viaje no encontrado' });

      if (request.method === 'GET' && match[2] === 'historial-transiciones') {
        return send(response, 200, { historial: viaje.historialTransiciones });
      }

      if (request.method !== 'POST') return send(response, 404, { error: 'Ruta no encontrada' });
      const input = await readJson(request);

      if (match[2] === 'finalizacion') {
        viaje.validarFinalizacion();
        const data = validarFinalizacion(input, viaje.inicio);
        const estimacion = await options.externalApis.estimateDistance({
          origen: data.origen,
          destino: data.destino,
        });
        const total = await options.externalApis.estimateFare({
          origen: data.origen,
          destino: data.destino,
          distanciaKm: estimacion.distanciaKm,
          tiempoEstimadoMin: estimacion.tiempoEstimadoMin,
          tipoVehiculo: data.tipoVehiculo,
        });
        await options.externalApis.registerPayment({
          clienteId: viaje.clienteId,
          viajeId: viaje.id,
          metodoPago: data.metodoPago,
        });
        const paymentId = await options.externalApis.authorizePayment(viaje.id);
        viaje.finalizar({
          tiempoMinutos: estimacion.tiempoEstimadoMin,
          distanciaKm: estimacion.distanciaKm,
          horaFin: data.horaFin,
          metodoPago: data.metodoPago,
          total,
          origen: data.origen,
          destino: data.destino,
          tipoVehiculo: data.tipoVehiculo,
          fuenteMetrica: 'M4',
          metricasEstimadas: true,
        });
        await repository.save(viaje);
        return send(response, 200, {
          viaje,
          paymentId,
          metricasEstimadas: true,
          fuenteMetrica: 'M4',
        });
      }

      if (match[2] === 'cancelacion-cliente') {
        const motivo = String((input as { motivo?: string }).motivo ?? '');
        const cargo = await options.externalApis.cancellationCharge({ viajeId: viaje.id, estado: viaje.estado });
        viaje.cancelarPorCliente({ motivo, cargo });
        await repository.save(viaje);
        return send(response, 200, { viaje });
      }

      const motivo = String((input as { motivo?: string }).motivo ?? '');
      const retornoDespacho = await options.externalApis.returnClientToDispatch({
        viajeId: viaje.id,
        conductorId: viaje.conductorId,
      });
      viaje.cancelarPorConductor({ motivo });
      viaje.retornoDespacho = retornoDespacho;
      await repository.save(viaje);
      return send(response, 200, { viaje, retornoDespacho });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Solicitud inválida';
      const status = error instanceof ServiceUnavailableError ? 503 : error instanceof BadGatewayError ? 502 : 400;
      return send(response, status, { error: message });
    }
  });
}

export function crearViaje(data: CrearViajeInput): Viaje {
  return new Viaje(data);
}

interface FinalizarViajeRequest {
  origen: CoordenadasViaje;
  destino: CoordenadasViaje;
  tipoVehiculo: TipoVehiculoViaje;
  horaFin: Date;
  metodoPago: string;
}

function validarFinalizacion(input: Record<string, unknown>, inicio: Date): FinalizarViajeRequest {
  const origen = validarCoordenadas(input.origen, 'origen');
  const destino = validarCoordenadas(input.destino, 'destino');
  if (origen.latitude === destino.latitude && origen.longitude === destino.longitude) {
    throw new Error('El origen y el destino no pueden ser iguales');
  }
  if (input.tipoVehiculo !== 'auto' && input.tipoVehiculo !== 'moto') {
    throw new Error('tipoVehiculo debe ser auto o moto');
  }
  if (!['efectivo', 'tarjeta', 'transferencia'].includes(String(input.metodoPago))) {
    throw new Error('metodoPago debe ser efectivo, tarjeta o transferencia');
  }
  const horaFin = new Date(String(input.horaFin));
  if (Number.isNaN(horaFin.getTime()) || horaFin < inicio) {
    throw new Error('horaFin debe ser una fecha válida posterior al inicio del viaje');
  }
  return {
    origen,
    destino,
    tipoVehiculo: input.tipoVehiculo,
    horaFin,
    metodoPago: String(input.metodoPago),
  };
}

function validarCoordenadas(value: unknown, nombre: string): CoordenadasViaje {
  if (!value || typeof value !== 'object') {
    throw new Error(`${nombre} es obligatorio y debe contener coordenadas`);
  }
  const coordinates = value as Record<string, unknown>;
  const latitude = coordinates.latitude;
  const longitude = coordinates.longitude;
  if (
    !isFiniteNumber(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !isFiniteNumber(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error(`${nombre} debe tener latitud y longitud válidas`);
  }
  if (coordinates.address !== undefined && typeof coordinates.address !== 'string') {
    throw new Error(`${nombre}.address debe ser texto`);
  }
  return {
    latitude,
    longitude,
    ...(typeof coordinates.address === 'string' ? { address: coordinates.address } : {}),
  };
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
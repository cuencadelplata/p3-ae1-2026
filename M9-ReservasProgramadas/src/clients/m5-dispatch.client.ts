import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { Reserva, TipoVehiculo } from '../domain/reserva.js';
import { ExternalServiceError } from '../errors/external-service.error.js';
import { fetchWithTimeout } from '../http/fetch-with-timeout.js';
import { getRequestContext } from '../integration/request-context.js';
import type { GeoLocation } from '../integration/route-estimate.port.js';

export interface DispatchTokenProvider {
  getAuthorization(): Promise<string | undefined>;
}

export interface DispatchOperationStore {
  getOrCreate(reservaId: string): Promise<string>;
}

export class RequestContextTokenProvider implements DispatchTokenProvider {
  public async getAuthorization(): Promise<string | undefined> {
    return getRequestContext()?.authorization;
  }
}

/** Adaptador temporal para service tokens inyectados por entorno; nunca contiene credenciales. */
export class EnvironmentTokenProvider implements DispatchTokenProvider {
  public constructor(private readonly token?: string) {}

  public async getAuthorization(): Promise<string | undefined> {
    if (this.token === undefined || this.token.trim() === '') return undefined;
    return this.token.startsWith('Bearer ') ? this.token : `Bearer ${this.token}`;
  }
}

// Solo para pruebas/desarrollo. La implementación durable debe persistir la clave con la reserva.
export class InMemoryDispatchOperationStore implements DispatchOperationStore {
  private readonly keys = new Map<string, string>();

  public async getOrCreate(reservaId: string): Promise<string> {
    const existing = this.keys.get(reservaId);
    if (existing !== undefined) return existing;
    const created = randomUUID();
    this.keys.set(reservaId, created);
    return created;
  }
}

export interface CreateRideRequestInput {
  reserva: Pick<Reserva, 'id' | 'clienteId' | 'vehiculo'>;
  origin: GeoLocation;
  destination: GeoLocation;
}

export interface M5RideRequest {
  requestId: string;
  clientId: string;
  status:
    | 'PENDING'
    | 'SEARCHING'
    | 'OFFERED'
    | 'ASSIGNED'
    | 'EXPIRED'
    | 'NO_DRIVERS_AVAILABLE'
    | 'CANCELLED';
  assignedDriverId: string | null;
}

const responseSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string(),
  status: z.enum([
    'PENDING',
    'SEARCHING',
    'OFFERED',
    'ASSIGNED',
    'EXPIRED',
    'NO_DRIVERS_AVAILABLE',
    'CANCELLED',
  ]),
  assignedDriverId: z.string().nullable().optional(),
});

const cancellationResponseSchema = z.object({
  requestId: z.string().uuid(),
  clientId: z.string(),
  status: z.literal('CANCELLED'),
});

export interface DispatchClient {
  createRequest(input: CreateRideRequestInput): Promise<M5RideRequest>;
  getRequest(requestId: string): Promise<M5RideRequest>;
  cancelRequest(requestId: string, reason?: string): Promise<M5RideRequest>;
}

export const toM5CreateRideRequest = (input: CreateRideRequestInput) => ({
  origin: {
    latitude: input.origin.latitude,
    longitude: input.origin.longitude,
    address: input.origin.address,
  },
  destination: {
    latitude: input.destination.latitude,
    longitude: input.destination.longitude,
    address: input.destination.address,
  },
  vehicleType: input.reserva.vehiculo satisfies TipoVehiculo,
});

export class M5DispatchClient implements DispatchClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly tokenProvider: DispatchTokenProvider,
    private readonly operationStore: DispatchOperationStore,
  ) {}

  public async createRequest(input: CreateRideRequestInput): Promise<M5RideRequest> {
    const authorization = await this.requireAuthorization();
    const idempotencyKey = await this.operationStore.getOrCreate(input.reserva.id);
    return this.request('/api/v1/ride-requests', {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
        ...this.correlationHeader(),
      },
      body: JSON.stringify(toM5CreateRideRequest(input)),
    });
  }

  public async getRequest(requestId: string): Promise<M5RideRequest> {
    const authorization = await this.requireAuthorization();
    return this.request(`/api/v1/ride-requests/${encodeURIComponent(requestId)}`, {
      method: 'GET',
      headers: { authorization, ...this.correlationHeader() },
    });
  }

  public async cancelRequest(requestId: string, reason?: string): Promise<M5RideRequest> {
    const authorization = await this.requireAuthorization();
    const response = await fetchWithTimeout(
      'M5',
      new URL(`/api/v1/ride-requests/${encodeURIComponent(requestId)}/cancel`, this.baseUrl),
      {
        method: 'POST',
        headers: {
          authorization,
          'content-type': 'application/json',
          ...this.correlationHeader(),
        },
        body: JSON.stringify(reason === undefined ? {} : { reason }),
      },
      this.timeoutMs,
    );
    if (!response.ok) throw ExternalServiceError.fromHttpStatus('M5', response.status);
    try {
      const parsed = cancellationResponseSchema.parse(await response.json());
      return {
        requestId: parsed.requestId,
        clientId: parsed.clientId,
        status: parsed.status,
        assignedDriverId: null,
      };
    } catch (cause) {
      throw ExternalServiceError.badResponse('M5', cause);
    }
  }

  private async request(path: string, init: RequestInit): Promise<M5RideRequest> {
    const response = await fetchWithTimeout(
      'M5',
      new URL(path, this.baseUrl),
      init,
      this.timeoutMs,
    );
    if (!response.ok) throw ExternalServiceError.fromHttpStatus('M5', response.status);
    try {
      const parsed = responseSchema.parse(await response.json());
      return {
        requestId: parsed.id,
        clientId: parsed.clientId,
        status: parsed.status,
        assignedDriverId: parsed.assignedDriverId ?? null,
      };
    } catch (cause) {
      throw ExternalServiceError.badResponse('M5', cause);
    }
  }

  private async requireAuthorization(): Promise<string> {
    const authorization = await this.tokenProvider.getAuthorization();
    if (authorization?.startsWith('Bearer ') !== true) {
      throw new ExternalServiceError(
        'M5',
        'AUTHENTICATION',
        401,
        'AUTENTICACION_M5_NO_CONFIGURADA',
        'No hay un Bearer token disponible para invocar M5.',
      );
    }
    return authorization;
  }

  private correlationHeader(): Record<string, string> {
    const correlationId = getRequestContext()?.correlationId;
    return correlationId === undefined ? {} : { 'x-correlation-id': correlationId };
  }
}

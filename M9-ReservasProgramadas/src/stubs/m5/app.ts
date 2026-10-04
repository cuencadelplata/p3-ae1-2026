import { randomUUID } from 'node:crypto';

import express from 'express';
import { z } from 'zod';

import type { TipoVehiculo } from '../../domain/reserva.js';

type RideStatus =
  | 'PENDING'
  | 'SEARCHING'
  | 'OFFERED'
  | 'ASSIGNED'
  | 'EXPIRED'
  | 'NO_DRIVERS_AVAILABLE'
  | 'CANCELLED';

export interface RideRequestStub {
  id: string;
  clientId: string;
  origin: { latitude: number; longitude: number; address: string };
  destination: { latitude: number; longitude: number; address: string };
  vehicleType: TipoVehiculo;
  status: RideStatus;
  assignedDriverId: string | null;
  estimatedFare: {
    amount: number;
    currency: string;
    estimatedDistanceKm: number;
    estimatedDurationMin: number;
  };
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface M5StubState {
  rideRequests: Map<string, RideRequestStub>;
  idempotencyRequests: Map<string, string>;
}

export const createM5StubState = (): M5StubState => ({
  rideRequests: new Map(),
  idempotencyRequests: new Map(),
});

const geoLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().min(1),
});
const createRideRequestSchema = z
  .object({
    origin: geoLocationSchema,
    destination: geoLocationSchema,
    vehicleType: z.enum(['AUTO', 'MOTO']),
  })
  .strict();

const error = (code: string, message: string) => ({
  code,
  message,
  timestamp: new Date().toISOString(),
});

export const createStubRideRequest = (
  state: M5StubState,
  input: z.infer<typeof createRideRequestSchema>,
  idempotencyKey: string,
  status: RideStatus = 'SEARCHING',
): RideRequestStub => {
  const existingId = state.idempotencyRequests.get(idempotencyKey);
  if (existingId !== undefined) return state.rideRequests.get(existingId)!;
  const now = new Date();
  const ride: RideRequestStub = {
    id: randomUUID(),
    clientId: 'm9-scheduled-reservation',
    ...input,
    status,
    assignedDriverId: status === 'ASSIGNED' ? '30000000-0000-4000-8000-000000000001' : null,
    estimatedFare: {
      amount: 0,
      currency: 'ARS',
      estimatedDistanceKm: 0,
      estimatedDurationMin: 0,
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 180_000).toISOString(),
  };
  state.rideRequests.set(ride.id, ride);
  state.idempotencyRequests.set(idempotencyKey, ride.id);
  return ride;
};

export const createM5StubApp = (state: M5StubState = createM5StubState()) => {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }));

  app.post('/api/v1/ride-requests', (request, response) => {
    if (request.header('authorization')?.startsWith('Bearer ') !== true) {
      response.status(401).json(error('UNAUTHORIZED', 'Bearer requerido.'));
      return;
    }
    const idempotencyKey = request.header('idempotency-key');
    if (!z.string().uuid().safeParse(idempotencyKey).success) {
      response.status(400).json(error('VALIDATION_ERROR', 'Idempotency-Key inválida.'));
      return;
    }
    const existingId = state.idempotencyRequests.get(idempotencyKey!);
    if (existingId !== undefined) {
      response.status(201).json(state.rideRequests.get(existingId));
      return;
    }
    const parsed = createRideRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(error('VALIDATION_ERROR', 'Body inválido.'));
      return;
    }
    if (
      parsed.data.origin.latitude === parsed.data.destination.latitude &&
      parsed.data.origin.longitude === parsed.data.destination.longitude
    ) {
      response.status(422).json(error('SEMANTIC_ERROR', 'Origen y destino idénticos.'));
      return;
    }
    const ride = createStubRideRequest(state, parsed.data, idempotencyKey!);
    response.status(201).json(ride);
  });

  app.get('/api/v1/ride-requests/:requestId', (request, response) => {
    if (request.header('authorization')?.startsWith('Bearer ') !== true) {
      response.status(401).json(error('UNAUTHORIZED', 'Bearer requerido.'));
      return;
    }
    const ride = state.rideRequests.get(request.params.requestId);
    if (ride === undefined) {
      response.status(404).json(error('NOT_FOUND', 'Solicitud no encontrada.'));
      return;
    }
    if (ride.status === 'SEARCHING') {
      ride.status = 'ASSIGNED';
      ride.assignedDriverId = '30000000-0000-4000-8000-000000000001';
      ride.updatedAt = new Date().toISOString();
    }
    response.json(ride);
  });

  app.post('/api/v1/ride-requests/:requestId/cancel', (request, response) => {
    if (request.header('authorization')?.startsWith('Bearer ') !== true) {
      response.status(401).json(error('UNAUTHORIZED', 'Bearer requerido.'));
      return;
    }
    const ride = state.rideRequests.get(request.params.requestId);
    if (ride === undefined) {
      response.status(404).json(error('NOT_FOUND', 'Solicitud no encontrada.'));
      return;
    }
    if (ride.status === 'ASSIGNED') {
      response.status(409).json(error('INVALID_STATE', 'La solicitud ya fue asignada.'));
      return;
    }
    ride.status = 'CANCELLED';
    ride.updatedAt = new Date().toISOString();
    response.json({
      requestId: ride.id,
      clientId: ride.clientId,
      status: 'CANCELLED',
      reason: typeof request.body?.reason === 'string' ? request.body.reason : null,
      cancelledAt: ride.updatedAt,
      message: 'Solicitud de viaje cancelada exitosamente por el cliente.',
    });
  });

  return app;
};

import type { ErrorRequestHandler, RequestHandler } from 'express';
import express from 'express';
import { z } from 'zod';

import {
  createM5StubState,
  M5StubDispatchService,
  M5StubError,
  type M5StubState,
  type OfferAction,
} from './dispatch.js';

export { createM5StubState } from './dispatch.js';
export type { M5StubState, RideRequestStub } from './dispatch.js';

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
const candidateSearchSchema = z
  .object({
    radiusKm: z.number().min(0.1).max(50).default(5),
    maxCandidates: z.number().int().min(1).max(50).default(5),
  })
  .strict();
const sendOffersSchema = z
  .object({
    driverIds: z.array(z.string().min(1)).min(1).optional(),
    ttlSeconds: z.number().int().min(5).max(180).default(30),
  })
  .strict();
const respondOfferSchema = z
  .object({
    action: z.enum(['ACCEPT', 'REJECT']),
    driverId: z.string().min(1).optional(),
  })
  .strict();

const error = (code: string, message: string) => ({
  code,
  message,
  timestamp: new Date().toISOString(),
});
const pathParam = (value: string | string[] | undefined): string => z.string().parse(value);

const requireBearer: RequestHandler = (request, response, next) => {
  if (request.header('authorization')?.startsWith('Bearer ') !== true) {
    response.status(401).json(error('UNAUTHORIZED', 'Bearer requerido.'));
    return;
  }
  next();
};

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };

export const createM5StubApp = (
  source: M5StubState | M5StubDispatchService = createM5StubState(),
) => {
  const dispatch =
    source instanceof M5StubDispatchService ? source : new M5StubDispatchService(source);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }));
  app.use('/api/v1', requireBearer);

  app.post('/api/v1/ride-requests', (request, response) => {
    const idempotencyKey = request.header('idempotency-key');
    if (!z.string().uuid().safeParse(idempotencyKey).success) {
      response.status(400).json(error('VALIDATION_ERROR', 'Idempotency-Key inválida.'));
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
    response.status(201).json(dispatch.createRequest(parsed.data, idempotencyKey!));
  });

  app.get('/api/v1/ride-requests/:requestId', (request, response) => {
    response.json(dispatch.getRequest(pathParam(request.params.requestId)));
  });

  app.post('/api/v1/ride-requests/:requestId/cancel', (request, response) => {
    const ride = dispatch.cancelRequest(pathParam(request.params.requestId));
    response.json({
      requestId: ride.id,
      clientId: ride.clientId,
      status: 'CANCELLED',
      reason: typeof request.body?.reason === 'string' ? request.body.reason : null,
      cancelledAt: ride.updatedAt,
      message: 'Solicitud de viaje cancelada exitosamente por el cliente.',
    });
  });

  app.post('/api/v1/ride-requests/:requestId/candidates', (request, response) => {
    const parsed = candidateSearchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json(error('VALIDATION_ERROR', 'Parámetros de búsqueda inválidos.'));
      return;
    }
    const ride = dispatch.getRequest(pathParam(request.params.requestId));
    const candidates = dispatch.searchCandidates(ride.id, parsed.data);
    if (candidates.length === 0) {
      response.status(404).json(error('NO_DRIVERS_AVAILABLE', 'No hay candidatos disponibles.'));
      return;
    }
    response.json({
      requestId: ride.id,
      vehicleType: ride.vehicleType,
      searchRadiusKm: parsed.data.radiusKm,
      candidatesCount: candidates.length,
      candidates: candidates.map(
        ({ driverId, vehicleType, distanceKm, estimatedEtaMinutes, rating }) => ({
          driverId,
          vehicleType,
          distanceKm,
          estimatedEtaMinutes,
          rating,
        }),
      ),
      searchTimestamp: new Date().toISOString(),
    });
  });

  app.post(
    '/api/v1/ride-requests/:requestId/offers',
    asyncRoute(async (request, response) => {
      const parsed = sendOffersSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json(error('VALIDATION_ERROR', 'Parámetros de oferta inválidos.'));
        return;
      }
      const requestId = pathParam(request.params.requestId);
      const offers = await dispatch.sendOffers(requestId, parsed.data);
      response.status(201).json({
        requestId,
        offersSentCount: offers.length,
        offers,
        message: `Oferta enviada a ${offers.length} conductor(es).`,
      });
    }),
  );

  app.get('/api/v1/ride-requests/:requestId/offers', (request, response) => {
    const requestId = pathParam(request.params.requestId);
    const offers = dispatch.getOffers(requestId);
    response.json({
      requestId,
      offersCount: offers.length,
      offers,
    });
  });

  const respond = async (offerId: string, action: OfferAction, driverId?: string) =>
    dispatch.respondToOffer(offerId, action, driverId);

  app.post(
    '/api/v1/offers/:offerId/respond',
    asyncRoute(async (request, response) => {
      const parsed = respondOfferSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(error('VALIDATION_ERROR', 'Respuesta de oferta inválida.'));
        return;
      }
      response.json(
        await respond(pathParam(request.params.offerId), parsed.data.action, parsed.data.driverId),
      );
    }),
  );

  for (const action of ['accept', 'reject'] as const) {
    app.post(
      `/api/v1/offers/:offerId/${action}`,
      asyncRoute(async (request, response) => {
        response.json(
          await respond(
            pathParam(request.params.offerId),
            action === 'accept' ? 'ACCEPT' : 'REJECT',
            typeof request.body?.driverId === 'string' ? request.body.driverId : undefined,
          ),
        );
      }),
    );
  }

  app.get('/api/v1/offers/:offerId', (request, response) => {
    response.json(dispatch.getOffer(pathParam(request.params.offerId)));
  });

  const errorHandler: ErrorRequestHandler = (cause, _request, response, _next) => {
    if (cause instanceof M5StubError) {
      response.status(cause.statusCode).json(error(cause.code, cause.message));
      return;
    }
    response.status(500).json(error('INTERNAL_ERROR', 'Error interno del stub M5.'));
  };
  app.use(errorHandler);
  return app;
};

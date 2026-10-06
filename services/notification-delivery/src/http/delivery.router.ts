import express, { Router, type NextFunction, type Request, type Response } from 'express';

import type { AppDependencies } from './app.js';
import { extractAuthenticatedUser } from './auth/m1-auth.middleware.js';
import {
  ContractValidationError,
  validateNotificationRequestedEnvelope,
} from '../domain/notification-requested.contract.js';
import { NotificationDeliveryService } from '../services/notification-delivery.service.js';

type DeliveryDependencies = Required<
  Pick<
    AppDependencies,
    'deliveryService' | 'tokenRepo' | 'inboxRepo' | 'deliveryRepo' | 'sandboxProvider'
  >
> &
  Pick<AppDependencies, 'isReady'>;

/**
 * Expone Delivery dentro de la aplicación M8 sin conservar un segundo servidor HTTP.
 * Las rutas y respuestas replican las que el listener independiente mantiene para
 * compatibilidad mientras se completa la migración al bootstrap común.
 */
export function createDeliveryRouter(deps: DeliveryDependencies): Router {
  const router = Router();
  const deliveryService = deps.deliveryService;

  router.use(express.json());

  router.post('/devices/tokens', async (request, response) => {
    const user = extractAuthenticatedUser(request.headers.authorization);
    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const { token, platform = 'ANDROID' } = request.body as {
      token?: unknown;
      platform?: unknown;
    };
    if (typeof token !== 'string' || token.trim() === '') {
      response.status(400).json({
        error: { code: 'INVALID_TOKEN', message: 'El campo token es obligatorio.' },
      });
      return;
    }

    const normalizedPlatform = normalizePlatform(platform);
    const record = await deps.tokenRepo.upsertToken(user.userId, token.trim(), normalizedPlatform);
    response.status(201).json({
      message: 'Device token registrado con éxito.',
      data: record,
    });
  });

  router.get('/devices/tokens', async (request, response) => {
    const user = extractAuthenticatedUser(request.headers.authorization);
    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const tokens = await deps.tokenRepo.getActiveTokensByUserId(user.userId);
    response.status(200).json({ data: tokens });
  });

  router.delete('/devices/tokens/:token', async (request, response) => {
    const user = extractAuthenticatedUser(request.headers.authorization);
    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const deactivated = await deps.tokenRepo.deactivateToken(user.userId, request.params.token);
    if (!deactivated) {
      response.status(404).json({
        error: {
          code: 'TOKEN_NOT_FOUND',
          message: 'El token no fue encontrado o no pertenece al usuario autenticado.',
        },
      });
      return;
    }

    response.status(200).json({ message: 'Device token desactivado con éxito.' });
  });

  router.get('/internal/deliveries/:notificationId', async (request, response) => {
    const user = extractAuthenticatedUser(request.headers.authorization);
    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const delivery = await deliveryService.getDeliveryByNotificationId(request.params.notificationId);
    if (!delivery) {
      response.status(404).json({
        error: {
          code: 'DELIVERY_NOT_FOUND',
          message: `No se encontró registro de entrega para notificationId '${request.params.notificationId}'.`,
        },
      });
      return;
    }

    if (user.role !== 'OPERADOR' && user.userId !== delivery.userId) {
      response.status(403).json({
        error: { code: 'FORBIDDEN', message: 'No tiene permisos para consultar esta entrega.' },
      });
      return;
    }

    const { deviceToken: _deviceToken, ...safeDelivery } = delivery;
    response.status(200).json({ data: safeDelivery });
  });

  router.post('/internal/deliveries/simulate', async (request, response) => {
    if (process.env.NODE_ENV === 'production') {
      response.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Endpoint de simulación deshabilitado en entorno de producción.',
        },
      });
      return;
    }

    try {
      const envelope = validateNotificationRequestedEnvelope(request.body);
      await sendSimulationResult(deliveryService, envelope, response);
    } catch (error: unknown) {
      if (error instanceof ContractValidationError) {
        response.status(400).json({
          error: { code: 'CONTRACT_VALIDATION_ERROR', message: error.message },
        });
        return;
      }

      const message = error instanceof Error ? error.message : 'Error interno';
      response.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
  });

  router.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    if (error instanceof SyntaxError && 'body' in error) {
      response.status(400).json({
        error: { code: 'INVALID_JSON', message: 'El cuerpo de la solicitud debe ser JSON válido.' },
      });
      return;
    }
    next(error);
  });

  return router;
}

async function sendSimulationResult(
  deliveryService: NotificationDeliveryService,
  envelope: ReturnType<typeof validateNotificationRequestedEnvelope>,
  response: Response,
): Promise<void> {
  const result = await deliveryService.processNotificationRequest(envelope);
  if (result.actionTaken === 'ACK_DUPLICATE') {
    response.status(200).json({
      message: 'Evento duplicado ignorado de forma idempotente en Inbox.',
      data: result,
    });
    return;
  }
  if (result.actionTaken === 'SKIPPED_PREFERENCE_OFF') {
    response.status(200).json({
      message: 'Entrega omitida por preferencia de usuario en M2 desactivada.',
      data: result,
    });
    return;
  }
  if (result.actionTaken === 'FAILED') {
    response.status(502).json({
      error: { code: 'DELIVERY_FAILED', message: result.error },
      data: result,
    });
    return;
  }

  response.status(200).json({
    message: 'Notificación procesada y entregada con éxito.',
    data: result,
  });
}

function sendUnauthorized(response: Response): void {
  response.status(401).json({
    error: {
      code: 'UNAUTHORIZED',
      message: 'Se requiere token JWT de M1 válido en el header Authorization: Bearer <token>.',
    },
  });
}

function normalizePlatform(platform: unknown): 'ANDROID' | 'IOS' | 'WEB' {
  if (platform === 'ANDROID' || platform === 'IOS' || platform === 'WEB') {
    return platform;
  }
  return 'ANDROID';
}

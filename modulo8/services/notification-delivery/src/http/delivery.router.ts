import express, { Router, type NextFunction, type Request, type Response } from 'express';

import type { AppDependencies } from './app.js';
import {
  extractAuthenticatedUser,
  type AuthenticatedUser,
  type M1IdentityCheck,
} from './auth/m1-auth.middleware.js';
import {
  ContractValidationError,
  validateNotificationRequestedEnvelope,
} from '../domain/notification-requested.contract.js';
import { NotificationDeliveryService } from '../services/notification-delivery.service.js';
import { PUSH_SERVICE_WORKER, renderPushPage } from './push-page.js';

type DeliveryDependencies = Required<
  Pick<
    AppDependencies,
    'deliveryService' | 'tokenRepo' | 'inboxRepo' | 'deliveryRepo' | 'sandboxProvider'
  >
> &
  Pick<AppDependencies, 'isReady'> & {
    /** Página de activación de Web Push: clave VAPID pública y URL de M1 para el navegador. */
    webPush?: { publicKey?: string; m1PublicUrl: string };
    /** Confirma con M1 que el usuario del token sigue habilitado (bloqueados y revocados no pasan). */
    identityCheck?: M1IdentityCheck;
  };

/**
 * Expone Delivery dentro de la aplicación M8 sin conservar un segundo servidor HTTP.
 * Las rutas y respuestas replican las que el listener independiente mantiene para
 * compatibilidad mientras se completa la migración al bootstrap común.
 */
export function createDeliveryRouter(deps: DeliveryDependencies): Router {
  const router = Router();
  const deliveryService = deps.deliveryService;

  // Firma del token de M1 y, si está configurado, confirmación de M1 de que el
  // usuario sigue habilitado. Responde 401 o 503 y devuelve null si no pasa.
  const authenticate = async (request: Request, response: Response): Promise<AuthenticatedUser | null> => {
    const authorization = request.headers.authorization;
    const user = extractAuthenticatedUser(authorization);
    if (!user || !authorization) {
      sendUnauthorized(response);
      return null;
    }
    if (deps.identityCheck) {
      const status = await deps.identityCheck(authorization);
      if (status === 'unavailable') {
        response.status(503).json({
          error: { code: 'M1_IDENTITY_UNAVAILABLE', message: 'El servicio de identidad M1 no está disponible.' },
        });
        return null;
      }
      if (status === 'inactive') {
        sendUnauthorized(response);
        return null;
      }
    }
    return user;
  };

  if (deps.webPush) {
    const webPush = deps.webPush;
    router.get('/push', (_request, response) => {
      response
        .type('html')
        .setHeader('Cache-Control', 'no-store')
        .send(renderPushPage({ vapidPublicKey: webPush.publicKey, m1PublicUrl: webPush.m1PublicUrl }));
    });
    router.get('/push/sw.js', (_request, response) => {
      // La página está en /push: el worker de /push/sw.js necesita permiso para ese alcance.
      response
        .type('application/javascript')
        .setHeader('Cache-Control', 'no-cache')
        .setHeader('Service-Worker-Allowed', '/push')
        .send(PUSH_SERVICE_WORKER);
    });
  }

  router.use(express.json());

  router.post('/devices/tokens/test', async (request, response) => {
    const user = await authenticate(request, response);
    if (!user) return;
    const device = await deps.tokenRepo.getLatestActiveTokenByUserId(user.userId);
    if (!device) {
      response.status(404).json({
        error: { code: 'TOKEN_NOT_FOUND', message: 'El usuario no tiene un dispositivo activo registrado.' },
      });
      return;
    }
    const result = await deps.sandboxProvider.sendPush({
      notificationId: `prueba-${Date.now()}`,
      recipientId: user.userId,
      deviceToken: device.token,
      title: 'Aviso de prueba',
      body: 'Las notificaciones de Movilidad Urbana funcionan en este dispositivo.',
      priority: 'NORMAL',
      correlationId: `prueba-${user.userId}`,
    });
    if (result.statusCode === 404 || result.statusCode === 410) {
      await deps.tokenRepo.deactivateToken(user.userId, device.token);
    }
    if (!result.success) {
      response.status(502).json({ error: { code: 'PUSH_FAILED', message: result.error } });
      return;
    }
    response.status(202).json({ message: 'Aviso de prueba enviado.' });
  });

  router.post('/devices/tokens', async (request, response) => {
    const user = await authenticate(request, response);
    if (!user) return;

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
    const user = await authenticate(request, response);
    if (!user) return;

    const tokens = await deps.tokenRepo.getActiveTokensByUserId(user.userId);
    response.status(200).json({ data: tokens });
  });

  router.delete('/devices/tokens/:token', async (request, response) => {
    const user = await authenticate(request, response);
    if (!user) return;

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
    const user = await authenticate(request, response);
    if (!user) return;

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
  if (result.actionTaken === 'SKIPPED_NO_CUSTOMER_PROFILE') {
    response.status(200).json({ message: 'Entrega omitida: M2 no tiene perfil de cliente para el destinatario.', data: result });
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

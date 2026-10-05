import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { NotificationDeliveryService } from '../services/notification-delivery.service.js';
import {
  type MessagingInboxRepository,
  InMemoryMessagingInboxRepository,
} from '../infrastructure/database/inbox.repository.js';
import {
  type DeliveryRepository,
  InMemoryDeliveryRepository,
} from '../infrastructure/database/delivery.repository.js';
import {
  type DeviceTokenRepository,
  InMemoryDeviceTokenRepository,
} from '../infrastructure/database/device-token.repository.js';
import {
  type M2PreferencesClient,
  MockM2PreferencesClient,
} from '../infrastructure/clients/m2-preferences.client.js';
import {
  type PushDeliveryProvider,
} from '../infrastructure/provider/push-delivery-provider.js';
import { SandboxPushProvider } from '../infrastructure/provider/sandbox-push-provider.js';
import { extractAuthenticatedUser } from './auth/m1-auth.middleware.js';
import {
  validateNotificationRequestedEnvelope,
  ContractValidationError,
} from '../domain/notification-requested.contract.js';

export interface AppDependencies {
  deliveryService?: NotificationDeliveryService;
  tokenRepo?: DeviceTokenRepository;
  m2Client?: M2PreferencesClient;
  sandboxProvider?: PushDeliveryProvider;
  inboxRepo?: MessagingInboxRepository;
  deliveryRepo?: DeliveryRepository;
  isReady?: () => Promise<{ ok: boolean; checks: Record<string, string> }>;
}

export function createApp(deps: AppDependencies = {}): http.RequestListener {
  const tokenRepo = deps.tokenRepo ?? new InMemoryDeviceTokenRepository();
  const m2Client = deps.m2Client ?? new MockM2PreferencesClient();
  const sandboxProvider = deps.sandboxProvider ?? new SandboxPushProvider();
  const inboxRepo = deps.inboxRepo ?? new InMemoryMessagingInboxRepository();
  const deliveryRepo = deps.deliveryRepo ?? new InMemoryDeliveryRepository();

  const deliveryService =
    deps.deliveryService ??
    new NotificationDeliveryService(
      inboxRepo,
      deliveryRepo,
      tokenRepo,
      m2Client,
      sandboxProvider
    );

  return async (req: IncomingMessage, res: ServerResponse) => {
    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method?.toUpperCase() ?? 'GET';

    const sendJson = (statusCode: number, data: unknown) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    // 1. Health checks estándar de M8
    if (method === 'GET' && pathname === '/health/live') {
      sendJson(200, { status: 'ok', service: 'notification-delivery' });
      return;
    }

    if (method === 'GET' && (pathname === '/health/ready' || pathname === '/health')) {
      if (deps.isReady) {
        const result = await deps.isReady();
        const statusCode = result.ok ? 200 : 503;
        sendJson(statusCode, {
          status: result.ok ? 'ok' : 'unavailable',
          service: 'notification-delivery',
          checks: result.checks,
        });
        return;
      }

      sendJson(200, {
        status: 'ok',
        service: 'notification-delivery',
        checks: {
          inbox: 'ok',
          tokens: 'ok',
          provider: 'ok',
        },
      });
      return;
    }

    // 2. Endpoints de Device Tokens (Protegidos con JWT de M1)
    if (pathname === '/devices/tokens' || pathname.startsWith('/devices/tokens/')) {
      const user = extractAuthenticatedUser(req.headers.authorization);
      if (!user) {
        sendJson(401, {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Se requiere token JWT de M1 válido en el header Authorization: Bearer <token>.',
          },
        });
        return;
      }

      // POST /devices/tokens: Registrar / actualizar token
      if (method === 'POST' && pathname === '/devices/tokens') {
        let bodyRaw = '';
        req.on('data', (chunk) => {
          bodyRaw += chunk;
        });

        req.on('end', async () => {
          try {
            const body = bodyRaw ? JSON.parse(bodyRaw) : {};
            const { token, platform = 'ANDROID' } = body;

            if (!token || typeof token !== 'string' || token.trim() === '') {
              sendJson(400, {
                error: {
                  code: 'INVALID_TOKEN',
                  message: 'El campo token es obligatorio.',
                },
              });
              return;
            }

            const validPlatform = ['ANDROID', 'IOS', 'WEB'].includes(platform)
              ? platform
              : 'ANDROID';

            // El userId se deriva SIEMPRE del JWT autenticado (numérico canónico)
            const record = await tokenRepo.upsertToken(user.userId, token.trim(), validPlatform);

            sendJson(201, {
              message: 'Device token registrado con éxito.',
              data: record,
            });
          } catch {
            sendJson(400, {
              error: {
                code: 'INVALID_JSON',
                message: 'El cuerpo de la solicitud debe ser JSON válido.',
              },
            });
          }
        });
        return;
      }

      // GET /devices/tokens: Listar tokens activos del usuario
      if (method === 'GET' && pathname === '/devices/tokens') {
        const tokens = await tokenRepo.getActiveTokensByUserId(user.userId);
        sendJson(200, { data: tokens });
        return;
      }

      // DELETE /devices/tokens/:token: Desactivar token
      const deleteMatch = pathname.match(/^\/devices\/tokens\/([^/]+)$/);
      if (method === 'DELETE' && deleteMatch) {
        const tokenToDelete = decodeURIComponent(deleteMatch[1] ?? '');
        const deactivated = await tokenRepo.deactivateToken(user.userId, tokenToDelete);

        if (!deactivated) {
          sendJson(404, {
            error: {
              code: 'TOKEN_NOT_FOUND',
              message: 'El token no fue encontrado o no pertenece al usuario autenticado.',
            },
          });
          return;
        }

        sendJson(200, {
          message: 'Device token desactivado con éxito.',
        });
        return;
      }
    }

    // 3. GET /internal/deliveries/:notificationId (Auditoría)
    const deliveryMatch = pathname.match(/^\/internal\/deliveries\/([^/]+)$/);
    if (method === 'GET' && deliveryMatch) {
      const notificationId = decodeURIComponent(deliveryMatch[1] ?? '');
      const delivery = await deliveryService.getDeliveryByNotificationId(notificationId);

      if (!delivery) {
        sendJson(404, {
          error: {
            code: 'DELIVERY_NOT_FOUND',
            message: `No se encontró registro de entrega para notificationId '${notificationId}'.`,
          },
        });
        return;
      }

      sendJson(200, { data: delivery });
      return;
    }

    // 4. POST /internal/deliveries/simulate (Simulación y testing E2E)
    if (method === 'POST' && pathname === '/internal/deliveries/simulate') {
      let bodyRaw = '';
      req.on('data', (chunk) => {
        bodyRaw += chunk;
      });

      req.on('end', async () => {
        try {
          const parsedBody = bodyRaw ? JSON.parse(bodyRaw) : {};
          const validatedEnvelope = validateNotificationRequestedEnvelope(parsedBody);
          const result = await deliveryService.processNotificationRequest(validatedEnvelope);

          if (result.actionTaken === 'ACK_DUPLICATE') {
            sendJson(200, {
              message: 'Evento duplicado ignorado de forma idempotente en Inbox.',
              data: result,
            });
            return;
          }

          if (result.actionTaken === 'SKIPPED_PREFERENCE_OFF') {
            sendJson(200, {
              message: 'Entrega omitida por preferencia de usuario en M2 desactivada.',
              data: result,
            });
            return;
          }

          if (result.actionTaken === 'FAILED') {
            sendJson(502, {
              error: {
                code: 'DELIVERY_FAILED',
                message: result.error,
              },
              data: result,
            });
            return;
          }

          sendJson(200, {
            message: 'Notificación procesada y entregada con éxito.',
            data: result,
          });
        } catch (err: unknown) {
          if (err instanceof ContractValidationError) {
            sendJson(400, {
              error: {
                code: 'CONTRACT_VALIDATION_ERROR',
                message: err.message,
              },
            });
            return;
          }

          const message = err instanceof Error ? err.message : 'Error interno';
          sendJson(500, {
            error: {
              code: 'INTERNAL_ERROR',
              message,
            },
          });
        }
      });
      return;
    }

    sendJson(404, {
      error: {
        code: 'NOT_FOUND',
        message: `Ruta ${method} ${pathname} no encontrada.`,
      },
    });
  };
}

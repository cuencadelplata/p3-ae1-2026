import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { NotificationDeliveryService } from '../services/notification-delivery.service.js';
import { InMemoryInboxRepository } from '../infrastructure/database/inbox.repository.js';
import { InMemoryDeliveryRepository } from '../infrastructure/database/delivery.repository.js';
import { SandboxPushProvider } from '../infrastructure/provider/sandbox-push-provider.js';
import {
  validateNotificationRequestedEnvelope,
  ContractValidationError,
} from '../domain/notification-requested.contract.js';

export interface AppDependencies {
  deliveryService?: NotificationDeliveryService;
  sandboxProvider?: SandboxPushProvider;
}

export function createApp(deps: AppDependencies = {}): http.RequestListener {
  const sandboxProvider = deps.sandboxProvider ?? new SandboxPushProvider();
  const deliveryService =
    deps.deliveryService ??
    new NotificationDeliveryService(
      new InMemoryInboxRepository(),
      new InMemoryDeliveryRepository(),
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

    // Health live
    if (method === 'GET' && pathname === '/health/live') {
      sendJson(200, { status: 'ok', service: 'notification-delivery' });
      return;
    }

    // Health ready y alias /health
    if (method === 'GET' && (pathname === '/health/ready' || pathname === '/health')) {
      sendJson(200, {
        status: 'ok',
        service: 'notification-delivery',
        checks: {
          inbox: 'ok',
          provider: 'ok',
        },
      });
      return;
    }

    // GET /internal/deliveries/:notificationId
    const deliveryMatch = pathname.match(/^\/internal\/deliveries\/([^/]+)$/);
    if (method === 'GET' && deliveryMatch) {
      const notificationId = decodeURIComponent(deliveryMatch[1] ?? '');
      if (!notificationId) {
        sendJson(400, {
          error: {
            code: 'INVALID_PARAM',
            message: 'notificationId es obligatorio.',
          },
        });
        return;
      }

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

    // POST /internal/deliveries/simulate
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

          if (result.duplicate) {
            sendJson(200, {
              message: 'Evento duplicado ignorado de forma idempotente.',
              data: result,
            });
            return;
          }

          if (result.status === 'FAILED') {
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

    // Ruta no encontrada
    sendJson(404, {
      error: {
        code: 'NOT_FOUND',
        message: `Ruta ${method} ${pathname} no encontrada.`,
      },
    });
  };
}

import type { Request, Response } from 'express';
import {
  NotificationDeliveryService,
} from '../../services/notification-delivery.service.js';
import {
  validateNotificationRequestedEnvelope,
  ContractValidationError,
} from '../../domain/notification-requested.contract.js';

export class DeliveryController {
  constructor(
    private readonly deliveryService: NotificationDeliveryService,
    private readonly readinessCheck?: () => Promise<{ ok: boolean; checks: Record<string, string> }>
  ) {}

  getDeliveryByNotificationId = async (req: Request, res: Response): Promise<void> => {
    const { notificationId } = req.params;

    if (!notificationId || typeof notificationId !== 'string') {
      res.status(400).json({
        error: {
          code: 'INVALID_PARAM',
          message: 'notificationId es obligatorio.',
        },
      });
      return;
    }

    const delivery = await this.deliveryService.getDeliveryByNotificationId(notificationId);

    if (!delivery) {
      res.status(404).json({
        error: {
          code: 'DELIVERY_NOT_FOUND',
          message: `No se encontró registro de entrega para notificationId '${notificationId}'.`,
        },
      });
      return;
    }

    res.status(200).json({
      data: delivery,
    });
  };

  simulateDelivery = async (req: Request, res: Response): Promise<void> => {
    if (process.env.NODE_ENV === 'production') {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Endpoint de simulación deshabilitado en entorno de producción.',
        },
      });
      return;
    }

    try {
      const validatedEnvelope = validateNotificationRequestedEnvelope(req.body);
      const result = await this.deliveryService.processNotificationRequest(validatedEnvelope);

      if (result.actionTaken === 'ACK_DUPLICATE') {
        res.status(200).json({
          message: 'Evento duplicado ignorado de forma idempotente.',
          data: result,
        });
        return;
      }

      if (result.status === 'FAILED') {
        res.status(502).json({
          error: {
            code: 'DELIVERY_FAILED',
            message: result.error,
          },
          data: result,
        });
        return;
      }

      res.status(200).json({
        message: 'Notificación procesada y entregada con éxito.',
        data: result,
      });
    } catch (err: unknown) {
      if (err instanceof ContractValidationError) {
        res.status(400).json({
          error: {
            code: 'CONTRACT_VALIDATION_ERROR',
            message: err.message,
          },
        });
        return;
      }

      const message = err instanceof Error ? err.message : 'Error interno inesperado';
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message,
        },
      });
    }
  };

  healthLive = (_req: Request, res: Response): void => {
    res.status(200).json({ status: 'ok', service: 'notification-delivery' });
  };

  healthReady = async (_req: Request, res: Response): Promise<void> => {
    if (this.readinessCheck) {
      const result = await this.readinessCheck();
      const status = result.ok ? 'ok' : 'unavailable';
      const statusCode = result.ok ? 200 : 503;
      res.status(statusCode).json({
        status,
        service: 'notification-delivery',
        checks: result.checks,
      });
      return;
    }

    res.status(200).json({
      status: 'ok',
      service: 'notification-delivery',
      checks: {
        inbox: 'ok',
        provider: 'ok',
        m2_preferences: 'degraded_mode_supported',
      },
    });
  };
}

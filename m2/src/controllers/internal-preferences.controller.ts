import type { Request, Response } from 'express';
import { customerService, type CustomerService } from '../services/customer.service.js';
import { ServiceUnavailableError } from '../errors/service-unavailable.error.js';
import { logger } from '../observability/logging.js';
import { UserIdSchema, type CustomerProfile, type NotificationChannel } from '../types/customer.js';

/**
 * Contrato acordado con M8 (RF8.7) para GET /internal/preferences/{userId}.
 * - pushEnabled: true solo si notificationChannel es "push" (el default "email" implica false).
 * - notificationsEnabled: false solo si la cuenta está dada de baja (INACTIVO).
 */
export interface NotificationPreferencesResponse {
  readonly userId: number;
  readonly notificationsEnabled: boolean;
  readonly pushEnabled: boolean;
  readonly notificationChannel: NotificationChannel;
}

export function toNotificationPreferences(customer: CustomerProfile): NotificationPreferencesResponse {
  return {
    userId: customer.userId,
    notificationsEnabled: customer.status !== 'INACTIVO',
    pushEnabled: customer.preferences.notificationChannel === 'push',
    notificationChannel: customer.preferences.notificationChannel
  };
}

// M8 corta a los 3000 ms: M2 responde (o devuelve 503) antes, para que M8 reciba un 503 y no un timeout.
const DEFAULT_DEADLINE_MS = 1800;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function deadlineMs(): number {
  const configured = Number.parseInt(process.env.INTERNAL_PREFERENCES_DEADLINE_MS ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_DEADLINE_MS;
}

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ServiceUnavailableError(`M2 no respondió preferencias en ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export class InternalPreferencesController {
  constructor(private readonly service: CustomerService = customerService) {}

  getPreferences = async (req: Request, res: Response): Promise<void> => {
    const rawCorrelationId = req.header('x-correlation-id');
    const correlationId = rawCorrelationId !== undefined && CORRELATION_ID_PATTERN.test(rawCorrelationId)
      ? rawCorrelationId
      : undefined;
    if (correlationId !== undefined) res.setHeader('X-Correlation-Id', correlationId);

    const rawUserId = req.params.userId;
    const userId = UserIdSchema.safeParse(/^\d+$/.test(rawUserId) ? Number(rawUserId) : Number.NaN);
    if (!userId.success) {
      res.status(400).json({ error: 'BadRequest', message: 'userId debe ser un entero positivo (id numérico de M1)' });
      return;
    }

    const customer = await withDeadline(this.service.getCustomerByUserId(userId.data), deadlineMs());
    if (!customer) {
      logger.info({ event: 'internal_preferences', userId: userId.data, correlationId, result: 'CustomerNotFound' });
      res.status(404).json({
        error: 'CustomerNotFound',
        message: `El usuario ${userId.data} no tiene perfil de cliente en M2`
      });
      return;
    }

    const preferences = toNotificationPreferences(customer);
    logger.info({ event: 'internal_preferences', userId: userId.data, correlationId, result: 'OK' });
    res.status(200).json(preferences);
  };
}

export const internalPreferencesController = new InternalPreferencesController();

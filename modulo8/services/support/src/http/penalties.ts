import { createHash, timingSafeEqual } from 'node:crypto';
import type { IRouter, Request, Response } from 'express';
import { concurrencyConflict, forbidden, SupportError, validationError } from '../errors/support-error.js';
import type { AuthenticatedUser, IdentityVerifier } from '../integrations/m1-identity.js';
import type { AccountUnlocker } from '../integrations/m2-account-review.js';
import type { M6TripsClient } from '../integrations/m6-trips.js';
import type { PenaltyRepository } from '../repositories/penalty.repository.js';
import type { TicketService } from '../services/ticket.service.js';
import { authenticateWithM1 } from './authentication.js';
import { correlationId } from './correlation.js';
import { supportErrorHandler } from './error-handler.js';

export const CONFIRM_PENALTY_PATH = '/tickets/:id/penalizacion';
export const ACTIVE_PENALTIES_PATH = '/usuarios/:userId/penalizaciones';
export const UNLOCK_ACCOUNT_PATH = '/tickets/:id/desbloqueo';

export interface PenaltyRouteDeps {
  repository: PenaltyRepository;
  trips?: Pick<M6TripsClient, 'clienteDe'>;
  internalKey?: string;
  unlockAccount?: AccountUnlocker;
}

function unavailable(): never {
  throw new SupportError(503, 'SUPPORT_INTERNAL_ERROR', 'El servicio de penalizaciones no está configurado.');
}

function hashKey(key: string): Buffer {
  return createHash('sha256').update(key).digest();
}

export function registerPenaltyRoutes(
  router: IRouter,
  ticketService: TicketService,
  verifyIdentity?: IdentityVerifier,
  deps?: PenaltyRouteDeps,
): void {
  const authenticate = verifyIdentity ? authenticateWithM1(verifyIdentity) : unavailable;
  const expectedKey = deps?.internalKey ? hashKey(deps.internalKey) : undefined;

  async function resolvedTicketCustomer(ticketId: string, action: string) {
    if (!deps?.trips) unavailable();
    const ticket = await ticketService.obtenerTicket(ticketId);
    if (ticket.estado !== 'RESUELTO') {
      throw new SupportError(409, 'SUPPORT_INVALID_TRANSITION', `${action} requiere un ticket resuelto.`);
    }
    const userId = await deps.trips.clienteDe(ticket.tripId);
    if (userId === null) {
      throw new SupportError(422, 'SUPPORT_VALIDATION_ERROR', 'M6 no informó el userId de M1 del cliente del viaje.');
    }
    return { ticket, userId };
  }

  router.post(CONFIRM_PENALTY_PATH, correlationId, authenticate, async (req: Request, res: Response) => {
    const operator = res.locals.usuarioAutenticado as AuthenticatedUser;
    if (operator.role !== 'OPERADOR') throw forbidden();
    if (!deps?.trips) unavailable();
    const reason = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
    if (!reason || reason.length > 500) {
      throw validationError([{ field: 'motivo', reason: 'Indicá el motivo confirmado, de 1 a 500 caracteres.' }]);
    }

    const { ticket, userId } = await resolvedTicketCustomer(String(req.params.id), 'La penalización');

    const created = await deps.repository.confirm(ticket, userId, operator.userId, reason);
    if (created) {
      res.status(201).json(created);
      return;
    }

    const existing = await deps.repository.findForTrip(userId, ticket.tripId);
    if (!existing) throw concurrencyConflict();
    if (existing.ticketId !== ticket.id || existing.motivo !== reason) {
      throw new SupportError(409, 'SUPPORT_IDEMPOTENCY_CONFLICT', 'Ya se registró una penalización para este cliente y viaje.');
    }
    res.status(200).json(existing);
  }, supportErrorHandler);

  router.post(UNLOCK_ACCOUNT_PATH, correlationId, authenticate, async (req: Request, res: Response) => {
    const operator = res.locals.usuarioAutenticado as AuthenticatedUser;
    if (operator.role !== 'OPERADOR') throw forbidden();
    if (!deps?.unlockAccount) unavailable();
    const motive = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
    if (motive.length < 3 || motive.length > 500) {
      throw validationError([{ field: 'motivo', reason: 'Indicá un motivo de revisión de 3 a 500 caracteres.' }]);
    }
    const { ticket, userId } = await resolvedTicketCustomer(String(req.params.id), 'El desbloqueo');
    res.json(await deps.unlockAccount({
      userId,
      operatorId: operator.userId,
      ticketId: ticket.id,
      motive,
      correlationId: res.locals.correlationId,
    }));
  }, supportErrorHandler);

  router.get(ACTIVE_PENALTIES_PATH, correlationId, async (req: Request, res: Response) => {
    if (!deps || !expectedKey) unavailable();
    const suppliedKey = req.get('X-Secret-Key');
    if (!suppliedKey || !timingSafeEqual(hashKey(suppliedKey), expectedKey)) {
      throw new SupportError(401, 'SUPPORT_INVALID_TOKEN', 'Se requiere una clave de servicio válida.');
    }

    const rawId = String(req.params.userId);
    const userId = Number(rawId);
    if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(userId)) {
      throw validationError([{ field: 'userId', reason: 'Debe ser un userId numérico positivo de M1.' }]);
    }
    const penalizaciones = await deps.repository.listActive(userId);
    res.set('Cache-Control', 'no-store').json({ userId, total: penalizaciones.length, penalizaciones });
  }, supportErrorHandler);
}

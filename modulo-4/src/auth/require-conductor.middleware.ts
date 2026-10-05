import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { driverIdSchema } from '../schemas/location.schema.js';
import {
  AuthenticationError,
  AuthorizationError,
  IdentityServiceUnavailableError,
  type IdentityValidator
} from './identity.types.js';

export const requireConductor = (identityValidator: IdentityValidator) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const identity = await identityValidator.validate(req.header('authorization'));
      const requestedDriverId = driverIdSchema.parse(req.params.driverId);
      if (identity.userId !== requestedDriverId) {
        throw new AuthorizationError('No puede operar sobre otro conductor');
      }
      res.locals.authenticatedUserId = identity.userId;
      next();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        res.status(401).json({ code: 'UNAUTHORIZED', message: error.message });
        return;
      }
      if (error instanceof AuthorizationError) {
        res.status(403).json({ code: 'FORBIDDEN', message: error.message });
        return;
      }
      if (error instanceof IdentityServiceUnavailableError) {
        res.status(503).json({ code: 'IDENTITY_SERVICE_UNAVAILABLE', message: error.message });
        return;
      }
      if (error instanceof ZodError) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'driverId invalido' });
        return;
      }
      next(error);
    }
  };

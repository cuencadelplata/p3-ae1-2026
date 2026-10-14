import { Router, type Express, type NextFunction, type Request, type Response } from "express";

import { ApiError } from "./http/api-error";
import type { QrService } from "./qr.service";
import { validateQrGenerationRequest, validateQrValidationRequest } from "./qr.validator";

const VALIDATION_ERROR_MESSAGE = "La solicitud contiene datos inválidos.";
const UNSUPPORTED_MEDIA_TYPE_MESSAGE = "El tipo de contenido debe ser application/json.";

function requireJsonContentType(req: Request): void {
  if (!req.is("application/json")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", UNSUPPORTED_MEDIA_TYPE_MESSAGE);
  }
}

export interface QrHandlers {
  generateQr(req: Request, res: Response, next: NextFunction): Promise<void>;
  validateQr(req: Request, res: Response, next: NextFunction): Promise<void>;
}

export function createQrHandlers(service: QrService): QrHandlers {
  async function generateQr(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      requireJsonContentType(req);

      const validation = validateQrGenerationRequest(req.body);
      if (!validation.ok) {
        throw new ApiError(400, "VALIDATION_ERROR", VALIDATION_ERROR_MESSAGE, validation.errors);
      }

      const result = await service.generateQr(validation.value.tripId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async function validateQr(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      requireJsonContentType(req);

      const validation = validateQrValidationRequest(req.body);
      if (!validation.ok) {
        throw new ApiError(400, "VALIDATION_ERROR", VALIDATION_ERROR_MESSAGE, validation.errors);
      }

      const result = await service.validateQr(validation.value.tripId, validation.value.token);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  return { generateQr, validateQr };
}

export function createQrRouter(service: QrService): Router {
  const handlers = createQrHandlers(service);

  const router = Router();
  router.post("/qr", handlers.generateQr);
  router.post("/qr/validate", handlers.validateQr);

  return router;
}

// Recibe el servicio ya armado: este módulo no crea store, config ni generador.
export function registerQrRoutes(app: Express, service: QrService): void {
  app.use(createQrRouter(service));
}

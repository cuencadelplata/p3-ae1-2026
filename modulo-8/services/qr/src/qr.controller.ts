import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type Express, type NextFunction, type Request, type Response } from "express";

import { ApiError } from "./http/api-error";
import type { QrService } from "./qr.service";
import { validateQrGenerationRequest, validateQrValidationRequest } from "./qr.validator";

const VALIDATION_ERROR_MESSAGE = "La solicitud contiene datos inválidos.";
const UNSUPPORTED_MEDIA_TYPE_MESSAGE = "El tipo de contenido debe ser application/json.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

      const operationId = req.header?.("Idempotency-Key");
      if (operationId !== undefined && !UUID_PATTERN.test(operationId)) {
        throw new ApiError(400, "VALIDATION_ERROR", VALIDATION_ERROR_MESSAGE, [
          { field: "Idempotency-Key", reason: "Debe ser un UUID válido." },
        ]);
      }
      const result = operationId === undefined
        ? await service.validateQr(validation.value.tripId, validation.value.token)
        : await service.validateQr(validation.value.tripId, validation.value.token, operationId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  return { generateQr, validateQr };
}

export function createQrRouter(service: QrService, internalApiKey?: string): Router {
  const handlers = createQrHandlers(service);

  const router = Router();
  const guards: Array<(req: Request, res: Response, next: NextFunction) => void> = [];
  if (internalApiKey !== undefined) {
    const expected = createHash("sha256").update(internalApiKey).digest();
    guards.push((req, _res, next) => {
      const supplied = req.header("x-api-key");
      const actual = createHash("sha256").update(supplied ?? "").digest();
      if (!supplied || !timingSafeEqual(actual, expected)) {
        next(new ApiError(401, "UNAUTHORIZED", "Clave de servicio ausente o inválida."));
        return;
      }
      next();
    });
  }
  router.post("/qr", ...guards, handlers.generateQr);
  router.post("/qr/validate", ...guards, handlers.validateQr);

  return router;
}

// Recibe el servicio ya armado: este módulo no crea store, config ni generador.
export function registerQrRoutes(app: Express, service: QrService, internalApiKey?: string): void {
  app.use(createQrRouter(service, internalApiKey));
}

import type { RequestHandler } from "express";

import { ApiError } from "../shared/api-error";
import { processNotification } from "./notification.service";
import { validateNotificationRequest } from "./notification.validator";
import type { PushProvider } from "./push-provider";

export function createProcessNotificationController(
  pushProvider: PushProvider,
): RequestHandler {
  return async (request, response) => {
    if (!request.is("application/json")) {
      throw new ApiError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "El tipo de contenido debe ser application/json.",
      );
    }

    const validation = validateNotificationRequest(request.body);

    if (!validation.valid) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "La solicitud contiene datos inválidos.",
        validation.details,
      );
    }

    const notification = await processNotification(validation.data, pushProvider);

    response.status(201).json(notification);
  };
}

import type { RequestHandler } from "express";

import { ApiError } from "../shared/api-error";
import { isMalformedJsonError } from "../shared/error-handler";
import { processNotification } from "./notification.service";
import { validateNotificationRequest } from "./notification.validator";
import type { PushProvider } from "./push-provider";

export function createProcessNotificationController( //recibe PushProvider
  pushProvider: PushProvider,
): RequestHandler { //devuelve un RequestHandler
  return async (request, response) => { //aca va la logica
    if (!request.is("application/json")) {//si no es json, tira error 415 porque el servidor solo acepta json
      throw new ApiError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "El tipo de contenido debe ser application/json.",
      );
    }

    const validation = validateNotificationRequest(request.body);//valida que el body sea correcto

    if (!validation.valid) {//si no es correcto, tira error 400 porque el body es incorrecto
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "La solicitud contiene datos inválidos.",
        validation.details,
      );
    }

    let notification;//la usamos para guardar la notificacion que sera procesada

    try {//aca va la logica de procesar la notificacion
      notification = await processNotification(validation.data, pushProvider);//procesa la notificacion con el body correcto y el pushProvider
    } catch (error) {//si hay error
      if (isMalformedJsonError(error)) {//si es error de mal json, lo tiramos directamente porque es un error del cliente
        throw error;
      }

      throw new ApiError(
        500,
        "NOTIFICATION_PROCESSING_ERROR",
        "No fue posible procesar la notificación.",
      ); //tira error 500 porque es un error del servidor
    }

    response.status(201).json(notification); //devuelve la notificacion procesada
  };
}

import type { ErrorRequestHandler, Response } from "express";

import { createLogger, errorFields } from "../observability/logger";
import { ApiError, type ErrorResponse } from "./api-error";

const log = createLogger("http");

export function isMalformedJsonError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { type?: unknown; status?: unknown; statusCode?: unknown };

  return (
    candidate.type === "entity.parse.failed" &&
    (candidate.status === 400 || candidate.statusCode === 400)
  );
}

function sendError(response: Response, status: number, body: ErrorResponse): void {
  response.status(status).json(body);
}

// Los errores 5xx se registran con su detalle; la respuesta mantiene el formato de error del
// servicio y nunca incluye la pila ni el mensaje interno de un error inesperado.
export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      log("error", "error del servicio al atender la solicitud", {
        method: request.method,
        status: error.status,
        code: error.code,
      });
    }
    sendError(response, error.status, {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }

  if (isMalformedJsonError(error)) {
    sendError(response, 400, {
      error: {
        code: "VALIDATION_ERROR",
        message: "La solicitud contiene datos inválidos.",
        details: [{ field: "body", reason: "El JSON no es válido." }],
      },
    });
    return;
  }

  log("error", "error inesperado al atender la solicitud", { method: request.method, ...errorFields(error) });
  sendError(response, 500, {
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "No fue posible procesar la solicitud.",
    },
  });
};

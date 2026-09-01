import type { ErrorRequestHandler, Response } from "express";

import { ApiError, type ErrorResponse } from "./api-error";

function isMalformedJsonError(error: unknown): boolean {
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

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ApiError) {
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

  sendError(response, 500, {
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "No fue posible procesar la solicitud.",
    },
  });
};

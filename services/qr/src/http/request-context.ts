import { randomUUID } from "node:crypto";

import type { Request, RequestHandler } from "express";

import { createLogger, withCorrelationId } from "../observability/logger";

export const CORRELATION_HEADER = "X-Correlation-Id";

// Sólo caracteres seguros y un largo acotado: el valor llega del cliente y se escribe en los
// logs y en el header de respuesta.
const VALID_CORRELATION_ID = /^[A-Za-z0-9._-]{1,128}$/;

const log = createLogger("http");

export function resolveCorrelationId(incoming: string | undefined): string {
  return incoming !== undefined && VALID_CORRELATION_ID.test(incoming) ? incoming : randomUUID();
}

// Ruta sin query string. Las rutas del servicio no llevan datos sensibles.
function loggablePath(request: Request): string {
  const [path = ""] = request.originalUrl.split("?");
  return path;
}

// Asigna un correlationId a cada solicitud: el que envía el cliente en X-Correlation-Id, si
// es válido, o uno nuevo. Se devuelve en el header de respuesta (nunca en el cuerpo) y se
// incluye en todos los logs de la solicitud, con una línea final con el resultado.
//
// Las consultas de salud no se registran acá: las hacen Docker y los balanceadores cada pocos
// segundos. El health informa por su cuenta los cambios de disponibilidad de Redis.
export const requestContext: RequestHandler = (request, response, next) => {
  const correlationId = resolveCorrelationId(request.header(CORRELATION_HEADER));
  const startedAt = performance.now();

  response.setHeader(CORRELATION_HEADER, correlationId);
  response.on("finish", () => {
    if (request.path.startsWith("/health")) {
      return;
    }
    withCorrelationId(correlationId, () =>
      log(response.statusCode >= 500 ? "error" : "info", "solicitud atendida", {
        method: request.method,
        path: loggablePath(request),
        status: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      }),
    );
  });

  withCorrelationId(correlationId, next);
};

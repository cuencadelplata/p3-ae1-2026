import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { RequestHandler } from 'express';

import { now, recordHttpRequest, trackActiveRequest, type RouteKind } from './metrics.js';
import { tracer } from './tracing.js';

/**
 * Normalización de rutas: la superficie HTTP de M9 es pequeña y conocida, así que se usan
 * reglas explícitas en lugar de depender de `req.route` (que en Express 5 puede no reflejar
 * el prefijo del router cuando el error sale del router). Nunca se emiten UUID ni query.
 */
const RULES: Array<[RegExp, string, RouteKind]> = [
  [/^\/reservas\/?$/, '/reservas', 'business'],
  [/^\/reservas\/[^/]+\/?$/, '/reservas/:id', 'business'],
  [/^\/health\/?$/, '/health', 'health'],
  [/^\/readiness\/?$/, '/readiness', 'health'],
  [/^\/openapi\.json$/, '/openapi.json', 'docs'],
  [/^\/docs(\/.*)?$/, '/docs', 'docs'],
];

const KNOWN_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

export const normalizeMethod = (method: string): string =>
  KNOWN_METHODS.has(method.toUpperCase()) ? method.toUpperCase() : '_OTHER';

export const normalizeRoute = (
  originalUrl: string,
  statusCode: number,
): { route: string; kind: RouteKind } => {
  const path = originalUrl.split('?')[0] ?? '/';
  for (const [pattern, route, kind] of RULES) {
    if (pattern.test(path)) return { route, kind };
  }
  return statusCode === 404
    ? { route: 'unmatched', kind: 'unmatched' }
    : { route: '/static', kind: 'static' };
};

export type RouteNormalizer = typeof normalizeRoute;

/**
 * Span SERVER + métricas HTTP. Extrae `traceparent` entrante (W3C) para continuar trazas
 * distribuidas. Debe registrarse antes que el resto de los middlewares.
 */
export const createHttpTelemetryMiddleware =
  (normalize: RouteNormalizer = normalizeRoute): RequestHandler =>
  (request, response, next) => {
    const startMs = now();
    const method = normalizeMethod(request.method);
    const parent = propagation.extract(context.active(), request.headers);
    const span = tracer().startSpan(
      method,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.request.method': method,
          'url.scheme': request.protocol,
        },
      },
      parent,
    );
    trackActiveRequest(method, 1);

    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      trackActiveRequest(method, -1);
      const statusCode = response.statusCode;
      const { route, kind } = normalize(request.originalUrl, statusCode);
      span.updateName(`${method} ${route}`);
      span.setAttributes({
        'http.route': route,
        'http.response.status_code': statusCode,
        'm9.route.kind': kind,
      });
      if (statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      recordHttpRequest({ method, route, statusCode, kind, startMs });
    };
    response.once('finish', finish);
    response.once('close', finish);

    context.with(trace.setSpan(parent, span), next);
  };

export const httpTelemetryMiddleware = createHttpTelemetryMiddleware();

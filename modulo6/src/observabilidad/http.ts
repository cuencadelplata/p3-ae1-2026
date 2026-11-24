import type { IncomingMessage, ServerResponse } from 'node:http';
import { conContexto, logger, requestIdActual } from './logger.js';
import { duracionHttp, registro, solicitudesHttp } from './metricas.js';

const RUTAS_SILENCIOSAS = new Set(['/health', '/metrics']);

/**
 * Envuelve un handler HTTP (Express o node:http) con:
 * contexto de correlación (X-Request-Id), métricas de solicitudes y un log por respuesta.
 * `rutaDe` devuelve la ruta parametrizada (ej. /api/viajes/:id/finalizacion) para no
 * crear una serie de métricas por cada id.
 */
export function observarSolicitud(
    request: IncomingMessage,
    response: ServerResponse,
    rutaDe: () => string,
    siguiente: () => void,
): void {
    const cabecera = request.headers['x-request-id'];
    conContexto(Array.isArray(cabecera) ? cabecera[0] : cabecera, () => {
        const inicio = process.hrtime.bigint();
        response.on('finish', () => {
            const segundos = Number(process.hrtime.bigint() - inicio) / 1e9;
            const ruta = rutaDe();
            const etiquetas = { method: request.method ?? 'GET', route: ruta, status: String(response.statusCode) };
            solicitudesHttp.inc(etiquetas);
            duracionHttp.observe(etiquetas, segundos);
            if (!RUTAS_SILENCIOSAS.has(ruta)) {
                const nivel = response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info';
                logger[nivel]({
                    http: { method: request.method, route: ruta, status: response.statusCode },
                    durationMs: Math.round(segundos * 1000),
                }, 'solicitud HTTP');
            }
        });
        const requestId = requestIdActual();
        if (requestId && !response.headersSent) response.setHeader('X-Request-Id', requestId);
        siguiente();
    });
}

/** Middleware de Express: X-Request-Id en la respuesta, métricas y log de acceso. */
export function middlewareObservabilidad() {
    return (req: any, res: any, next: () => void) => {
        observarSolicitud(req, res, () => (req.route ? `${req.baseUrl}${req.route.path}` : 'sin_ruta'), next);
    };
}

export async function responderMetricas(response: ServerResponse): Promise<void> {
    try {
        const cuerpo = await registro.metrics();
        response.writeHead(200, { 'content-type': registro.contentType });
        response.end(cuerpo);
    } catch (error) {
        logger.error({ err: error }, 'No se pudieron generar las métricas');
        response.writeHead(500, { 'content-type': 'text/plain' });
        response.end('error');
    }
}

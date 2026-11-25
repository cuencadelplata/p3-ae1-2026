import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BadGatewayError, ServiceUnavailableError } from '../rf-6.4-6.7/errors.js';
class Rf6ApiError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
export class HttpRf6ApiClient {
    baseUrl;
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }
    async getViaje(viajeId) {
        return this.request(`/api/viajes/${encodeURIComponent(viajeId)}`, { method: 'GET' });
    }
    async getViajesDeCliente(clienteId) {
        const result = await this.request(`/api/clientes/${encodeURIComponent(clienteId)}/viajes`, { method: 'GET' });
        return result.viajes;
    }
    async getViajesDeConductor(conductorId) {
        const result = await this.request(`/api/conductores/${encodeURIComponent(conductorId)}/viajes`, { method: 'GET' });
        return result.viajes;
    }
    async cancelViaje(input) {
        return this.request(`/api/viajes/${encodeURIComponent(input.viajeId)}/cancelacion`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ actor: input.actor, motivo: input.motivo }),
        });
    }
    async request(path, init) {
        let response;
        try {
            response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}${path}`, {
                ...init,
                signal: AbortSignal.timeout(5000),
            });
        }
        catch {
            throw new ServiceUnavailableError('No se pudo conectar con la API de Viajes');
        }
        if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            const message = detail?.error ?? `API RF-6 respondió ${response.status}`;
            if (response.status >= 500)
                throw new ServiceUnavailableError(message);
            throw new Rf6ApiError(response.status, message);
        }
        try {
            return await response.json();
        }
        catch {
            throw new BadGatewayError('La API de Viajes devolvió una respuesta JSON inválida');
        }
    }
}
export function createViajeApi(options) {
    return createServer(async (request, response) => {
        try {
            const requestPath = new URL(request.url ?? '/', 'http://localhost').pathname;
            const frontend = new Map([
                ['/cliente', { file: 'cancelacion.html', type: 'text/html; charset=utf-8' }],
                ['/conductor', { file: 'cancelacion.html', type: 'text/html; charset=utf-8' }],
                ['/cancelacion.css', { file: 'cancelacion.css', type: 'text/css; charset=utf-8' }],
                ['/cancelacion.js', { file: 'cancelacion.js', type: 'text/javascript; charset=utf-8' }],
            ]);
            if (request.method === 'GET' && requestPath === '/') {
                response.writeHead(302, { location: '/cliente' });
                response.end();
                return;
            }
            if (request.method === 'GET' && requestPath === '/health') {
                return send(response, 200, { status: 'ok' });
            }
            const asset = request.method === 'GET' ? frontend.get(requestPath) : undefined;
            if (asset) {
                const content = await readFile(resolve(process.cwd(), 'frontend', asset.file));
                response.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-cache' });
                response.end(content);
                return;
            }
            const listingMatch = requestPath.match(/^\/api\/(clientes|conductores)\/([^/]+)\/viajes$/);
            if (listingMatch && request.method === 'GET') {
                const identityId = decodeURIComponent(listingMatch[2]).trim();
                if (!identityId)
                    return send(response, 400, { error: 'El identificador es obligatorio' });
                const actor = listingMatch[1] === 'clientes' ? 'cliente' : 'conductor';
                let viajes;
                try {
                    viajes = actor === 'cliente'
                        ? await options.rf6Api.getViajesDeCliente(identityId)
                        : await options.rf6Api.getViajesDeConductor(identityId);
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : 'No se pudieron consultar los viajes';
                    return send(response, 502, { error: message });
                }
                return send(response, 200, { [actor === 'cliente' ? 'clienteId' : 'conductorId']: identityId, viajes });
            }
            const tripMatch = requestPath.match(/^\/api\/viajes\/([^/]+)$/);
            if (tripMatch && request.method === 'GET') {
                const viajeId = decodeURIComponent(tripMatch[1]);
                const viaje = await options.rf6Api.getViaje(viajeId);
                if (String(viaje.id) !== viajeId) {
                    return send(response, 502, { error: 'RF-6 devolvió un identificador distinto al solicitado' });
                }
                return send(response, 200, { viaje });
            }
            const match = request.url?.match(/^\/api\/viajes\/([^/]+)\/(cancelacion-cliente|cancelacion-conductor)$/);
            if (!match)
                return send(response, 404, { error: 'Ruta no encontrada' });
            if (request.method !== 'POST') {
                return send(response, 405, { error: 'Método no permitido' }, { Allow: 'POST' }); //Issue #20
            }
            const input = await readJson(request);
            const motivo = input.motivo?.trim() ?? '';
            if (!motivo)
                return send(response, 400, { error: 'El motivo de cancelación es obligatorio' });
            const actor = match[2] === 'cancelacion-cliente' ? 'cliente' : 'conductor';
            const viajeId = decodeURIComponent(match[1]);
            const viaje = await options.rf6Api.getViaje(viajeId);
            if (String(viaje.id) !== viajeId) {
                return send(response, 502, { error: 'RF-6 devolvió un ID distinto al solicitado' });
            }
            if (!['SOLICITADO', 'ASIGNADO', 'CONDUCTOR_EN_CAMINO', 'ARRIBADO', 'EN_CURSO'].includes(viaje.estado)) {
                return send(response, 400, { error: `No se puede cancelar un viaje en estado ${viaje.estado}` });
            }
            const viajeCancelado = await options.rf6Api.cancelViaje({ viajeId, actor, motivo });
            if (String(viajeCancelado.id) !== viajeId) {
                return send(response, 502, { error: 'RF-6 devolvió un ID distinto al cancelado' });
            }
            const routingKey = actor === 'conductor' ? 'despacho.reabrir' : 'cancelacion_cliente';
            await options.events.publish(routingKey, {
                viajeId: String(viajeCancelado.id),
                // M5 busca la solicitud por su propio id: viajeId es el id del viaje en M6.
                rideRequestId: viajeCancelado.rideRequestId ?? viaje.rideRequestId ?? null,
                clienteId: viajeCancelado.clienteId,
                conductorId: viajeCancelado.conductorId,
                motivo,
                evento: actor === 'conductor' ? 'cancelacion_conductor' : routingKey,
                timestamp: new Date().toISOString(),
            });
            return send(response, 200, { viaje: viajeCancelado });
        }
        catch (error) {
            if (error instanceof ServiceUnavailableError) {
                return send(response, 503, { error: error.message });
            }
            if (error instanceof BadGatewayError) {
                return send(response, 502, { error: error.message });
            }
            if (error instanceof Rf6ApiError) {
                return send(response, error.status, { error: error.message });
            }
            const message = error instanceof Error ? error.message : 'Solicitud inválida';
            const status = message.includes('Viaje no encontrado') ? 404 : 400;
            return send(response, status, { error: message });
        }
    });
}
async function readJson(request) {
    let body = '';
    for await (const chunk of request)
        body += chunk;
    return body ? JSON.parse(body) : {};
}
function send(response, status, body, headers = {}) {
    response.writeHead(status, { 'content-type': 'application/json', ...headers });
    response.end(JSON.stringify(body));
}

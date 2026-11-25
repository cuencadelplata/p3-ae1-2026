import type { Viaje } from '../models/viaje.model.js';
import type { FinalizacionPersistida } from '../repositories/viaje.repository.js';
import { llamadasDependencia, medir } from '../../observabilidad/metricas.js';

export interface CoordenadasFinalizacion {
    latitude: number;
    longitude: number;
    address?: string;
}

/** Datos de Mercado Pago que la app del cliente obtiene al tokenizar la tarjeta. */
export interface DatosPagoTarjeta {
    token: string;
    paymentMethodId: string;
    email: string;
}

export type MetodoPago = 'efectivo' | 'tarjeta' | 'transferencia';

export interface DatosFinalizacion {
    origen: CoordenadasFinalizacion;
    destino: CoordenadasFinalizacion;
    tipoVehiculo: 'auto' | 'moto';
    horaFin: Date;
    metodoPago: MetodoPago;
    pagoAplicacion?: { tarjeta?: DatosPagoTarjeta };
}

export class ErrorServicioFinalizacion extends Error {
    constructor(message: string, readonly status: 402 | 502 | 503) {
        super(message);
        this.name = 'ErrorServicioFinalizacion';
    }
}

interface RespuestaExterna {
    status: number;
    body: Record<string, unknown>;
}

const configuredTimeoutMs = Number(process.env.M4_M7_TIMEOUT_MS);
const timeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? configuredTimeoutMs
    : 2500;

function baseUrl(environmentKey: string, defaultUrl?: string): string {
    const url = process.env[environmentKey] || defaultUrl;
    if (!url) throw new ErrorServicioFinalizacion(`Falta configurar ${environmentKey}`, 503);
    return url.replace(/\/+$/, '');
}

/** M7 protege /metodo-pago con una API key interna (RNF-10/RNF-11: se configura por entorno). */
function headersM7(): Record<string, string> {
    const apiKey = process.env.M7_API_KEY;
    return apiKey ? { 'x-api-key': apiKey } : {};
}

/** Llamada a otro módulo, medida en m6_dependencia_request_duration_seconds. */
function requestJson(
    destino: { dependencia: 'm4' | 'm7'; operacion: string },
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    input?: unknown,
    headers: Record<string, string> = {},
    statusAceptados: number[] = [],
    requestTimeoutMs = timeoutMs,
): Promise<RespuestaExterna> {
    return medir(llamadasDependencia, destino, () => requestJsonSinMedir(method, url, input, headers, statusAceptados, requestTimeoutMs));
}

async function requestJsonSinMedir(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    input: unknown,
    headers: Record<string, string>,
    statusAceptados: number[],
    requestTimeoutMs: number,
): Promise<RespuestaExterna> {
    let response: Response;
    try {
        response = await fetch(url, {
            method,
            headers: {
                ...(input !== undefined ? { 'content-type': 'application/json' } : {}),
                ...headers,
            },
            body: input !== undefined ? JSON.stringify(input) : undefined,
            signal: AbortSignal.timeout(requestTimeoutMs),
        });
    } catch {
        throw new ErrorServicioFinalizacion(`Servicio externo no disponible: ${url}`, 503);
    }

    if (!response.ok && !statusAceptados.includes(response.status)) {
        throw new ErrorServicioFinalizacion(
            `El servicio externo respondió ${response.status}: ${url}`,
            response.status >= 500 ? 503 : 502,
        );
    }

    let body: unknown;
    try {
        body = await response.json();
    } catch {
        throw new ErrorServicioFinalizacion(`Respuesta JSON inválida del servicio externo: ${url}`, 502);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ErrorServicioFinalizacion(`Respuesta inválida del servicio externo: ${url}`, 502);
    }
    return { status: response.status, body: body as Record<string, unknown> };
}

function positiveFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Duración real del viaje: desde la transición a EN_CURSO hasta horaFin (mínimo 1 minuto). */
export function minutosTranscurridos(inicio: Date, fin: Date): number {
    return Math.max(1, Math.ceil((fin.getTime() - inicio.getTime()) / 60_000));
}

interface EstadoPago {
    pagoId: string;
    estado: 'pendiente' | 'autorizado';
}

function leerPago(body: Record<string, unknown>, contexto: string): { pagoId: string; estado: string } {
    if (typeof body.pagoId !== 'string' || body.pagoId.length === 0 || typeof body.estado !== 'string') {
        throw new ErrorServicioFinalizacion(`M7 devolvió una respuesta inválida al ${contexto}`, 502);
    }
    return { pagoId: body.pagoId, estado: body.estado };
}

/**
 * Registra y, si corresponde, autoriza el pago en M7.
 * Es idempotente: si un intento anterior ya registró o autorizó el pago del viaje
 * (por ejemplo, M7 autorizó pero falló el COMMIT en TripDB), se reutiliza.
 */
async function procesarPago(
    viaje: Viaje,
    data: DatosFinalizacion,
    total: number,
    moneda: string,
): Promise<EstadoPago> {
    const m7 = baseUrl('M7_URL');
    const rutaPago = `${m7}/metodo-pago/${encodeURIComponent(viaje.id)}`;

    const existente = await requestJson({ dependencia: 'm7', operacion: 'consultar_pago' }, 'GET', rutaPago, undefined, headersM7(), [404]);
    let pago = existente.status === 404
        ? leerPago((await requestJson({ dependencia: 'm7', operacion: 'registrar_pago' }, 'POST', `${m7}/metodo-pago`, {
            clienteId: viaje.clienteId,
            viajeId: viaje.id,
            tipo: data.metodoPago,
        }, headersM7())).body, 'registrar el método de pago')
        : leerPago(existente.body, 'consultar el pago del viaje');

    if (existente.status !== 404 && existente.body.viajeId !== undefined && existente.body.viajeId !== viaje.id) {
        throw new ErrorServicioFinalizacion('M7 devolvió un pago de otro viaje', 502);
    }
    if (existente.status !== 404 && existente.body.tipo !== undefined && existente.body.tipo !== data.metodoPago) {
        if (pago.estado !== 'pendiente' || existente.body.tipo !== 'tarjeta' || data.metodoPago === 'tarjeta') {
            throw new ErrorServicioFinalizacion('El medio de pago registrado en M7 no coincide con el solicitado', 402);
        }
        const cambio = await requestJson({ dependencia: 'm7', operacion: 'cambiar_medio_pago' }, 'PATCH', rutaPago,
            { tipo: data.metodoPago }, headersM7(), [409], Math.max(timeoutMs, 8_000));
        if (cambio.status === 409) {
            throw new ErrorServicioFinalizacion('Mercado Pago todavía no confirma el rechazo de la tarjeta. Actualizá el estado antes de cambiar el medio.', 402);
        }
        pago = leerPago(cambio.body, 'cambiar el método de pago');
        if (cambio.body.tipo !== data.metodoPago || cambio.body.viajeId !== viaje.id || pago.estado !== 'pendiente') {
            throw new ErrorServicioFinalizacion('M7 devolvió un pago incompatible al cambiar el medio', 502);
        }
    }

    if (pago.estado === 'autorizado') return { pagoId: pago.pagoId, estado: 'autorizado' };
    if (pago.estado !== 'pendiente') {
        throw new ErrorServicioFinalizacion(`El pago del viaje está en estado ${pago.estado}`, 402);
    }

    // Efectivo y transferencia se cobran fuera de la pasarela: el pago queda pendiente en M7.
    if (data.metodoPago !== 'tarjeta') return { pagoId: pago.pagoId, estado: 'pendiente' };

    const tarjeta = data.pagoAplicacion?.tarjeta;
    if (!tarjeta) throw new ErrorServicioFinalizacion('Faltan los datos tokenizados de la tarjeta', 402);
    const autorizacion = await requestJson({ dependencia: 'm7', operacion: 'autorizar_pago' }, 'POST', `${rutaPago}/autorizar`, {
        idOrden: `ORD-${viaje.id}`,
        total,
        moneda,
        token: tarjeta.token,
        paymentMethodId: tarjeta.paymentMethodId,
        email: tarjeta.email,
    }, headersM7(), [402, 409], Math.max(timeoutMs, 15_000));
    if (autorizacion.status === 409) {
        throw new ErrorServicioFinalizacion('El pago con tarjeta sigue en verificación. Esperá la confirmación de Mercado Pago.', 402);
    }
    if (autorizacion.status === 402) {
        throw new ErrorServicioFinalizacion('La tarjeta fue rechazada. Podés elegir efectivo o transferencia.', 402);
    }
    pago = leerPago(autorizacion.body, 'autorizar el pago');
    if (pago.estado !== 'autorizado') {
        throw new ErrorServicioFinalizacion('M7 no confirmó la autorización del pago', 502);
    }
    return { pagoId: pago.pagoId, estado: 'autorizado' };
}

/** Consulta el pago gestionado por M7 antes de completar el viaje. */
async function consultarPagoAutorizado(viaje: Viaje, metodoPago: MetodoPago): Promise<{ pagoId: string; estado: 'autorizado' }> {
    const m7 = baseUrl('M7_URL');
    const respuesta = await requestJson(
        { dependencia: 'm7', operacion: 'consultar_pago' }, 'GET',
        `${m7}/metodo-pago/${encodeURIComponent(viaje.id)}`, undefined, headersM7(), [404],
    );
    if (respuesta.status === 404) {
        throw new ErrorServicioFinalizacion('El viaje no tiene un pago autorizado en M7', 402);
    }
    const pago = respuesta.body;
    if (typeof pago.pagoId !== 'string' || !pago.pagoId || typeof pago.estado !== 'string') {
        throw new ErrorServicioFinalizacion('M7 devolvió una respuesta inválida al consultar el pago', 502);
    }
    if (pago.viajeId !== undefined && pago.viajeId !== viaje.id) {
        throw new ErrorServicioFinalizacion('M7 devolvió un pago de otro viaje', 502);
    }
    if (pago.estado !== 'autorizado') {
        throw new ErrorServicioFinalizacion(`El pago del viaje está en estado ${pago.estado}; M7 debe confirmar su autorización`, 402);
    }
    if (pago.tipo !== undefined && pago.tipo !== metodoPago) {
        throw new ErrorServicioFinalizacion('El medio de pago autorizado en M7 no coincide con el solicitado', 402);
    }
    return { pagoId: pago.pagoId, estado: 'autorizado' };
}

export async function ejecutarServiciosFinalizacion(
    viaje: Viaje,
    data: DatosFinalizacion,
    inicio: Date,
): Promise<FinalizacionPersistida> {
    const m4 = baseUrl('M4_URL', 'http://localhost:3001/api/v1');
    const m7 = baseUrl('M7_URL');
    const tiempoMinutos = minutosTranscurridos(inicio, data.horaFin);

    // M6 no recibe el recorrido GPS: la distancia se estima con M4 a partir de origen y destino.
    const estimacion = (await requestJson({ dependencia: 'm4', operacion: 'estimar_distancia' }, 'POST', `${m4}/estimate`, {
        origin: { latitude: data.origen.latitude, longitude: data.origen.longitude },
        destination: { latitude: data.destino.latitude, longitude: data.destino.longitude },
    })).body;
    if (!positiveFiniteNumber(estimacion.distanceKm) || !positiveFiniteNumber(estimacion.estimatedEtaMinutes)) {
        throw new ErrorServicioFinalizacion('M4 devolvió una estimación de distancia o ETA inválida', 502);
    }

    const tarifa = (await requestJson({ dependencia: 'm7', operacion: 'estimar_tarifa' }, 'POST', `${m7}/tarifa/estimacion`, {
        origen: {
            lat: data.origen.latitude,
            lng: data.origen.longitude,
            direccion: data.origen.address ?? '',
        },
        destino: {
            lat: data.destino.latitude,
            lng: data.destino.longitude,
            direccion: data.destino.address ?? '',
        },
        distanciaKm: estimacion.distanceKm,
        tiempoEstimadoMin: tiempoMinutos,
        vehicleType: data.tipoVehiculo,
    })).body;
    if (typeof tarifa.estimatedFare !== 'number' || !Number.isFinite(tarifa.estimatedFare) || tarifa.estimatedFare < 0) {
        throw new ErrorServicioFinalizacion('M7 devolvió una tarifa inválida', 502);
    }
    const moneda = typeof tarifa.currency === 'string' && tarifa.currency ? tarifa.currency : 'ARS';

    const pago = data.pagoAplicacion
        ? await procesarPago(viaje, data, tarifa.estimatedFare, moneda)
        : await consultarPagoAutorizado(viaje, data.metodoPago);

    return {
        inicio,
        horaFin: data.horaFin,
        tiempoMinutos,
        tiempoEstimadoMinutos: estimacion.estimatedEtaMinutes,
        distanciaKm: estimacion.distanceKm,
        metodoPago: data.metodoPago,
        total: tarifa.estimatedFare,
        moneda,
        origen: data.origen,
        destino: data.destino,
        tipoVehiculo: data.tipoVehiculo,
        fuenteMetrica: 'M4',
        metricasEstimadas: true,
        estadoPago: pago.estado,
        paymentId: pago.pagoId,
    };
}

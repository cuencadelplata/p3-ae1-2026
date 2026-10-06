import type { Viaje } from '../models/viaje.model.js';
import type { FinalizacionPersistida } from '../repositories/viaje.repository.js';

export interface CoordenadasFinalizacion {
    latitude: number;
    longitude: number;
    address?: string;
}

export interface DatosFinalizacion {
    origen: CoordenadasFinalizacion;
    destino: CoordenadasFinalizacion;
    tipoVehiculo: 'auto' | 'moto';
    horaFin: Date;
    metodoPago: 'efectivo' | 'tarjeta' | 'transferencia';
}

export class ErrorServicioFinalizacion extends Error {
    constructor(message: string, readonly status: 502 | 503) {
        super(message);
        this.name = 'ErrorServicioFinalizacion';
    }
}

interface RespuestaExterna {
    body: Record<string, unknown>;
}

const configuredTimeoutMs = Number(process.env.M4_M7_TIMEOUT_MS);
const timeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? configuredTimeoutMs
    : 2500;

function baseUrl(environmentKey: string, defaultUrl: string): string {
    return (process.env[environmentKey] || defaultUrl).replace(/\/+$/, '');
}

async function postJson(url: string, input: unknown): Promise<RespuestaExterna> {
    let response: Response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch {
        throw new ErrorServicioFinalizacion(`Servicio externo no disponible: ${url}`, 503);
    }

    if (!response.ok) {
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
    return { body: body as Record<string, unknown> };
}

function positiveFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export async function ejecutarServiciosFinalizacion(
    viaje: Viaje,
    data: DatosFinalizacion,
): Promise<FinalizacionPersistida> {
    const m4 = baseUrl('M4_URL', 'http://localhost:3001/api/v1');
    const m7 = baseUrl('M7_URL', 'http://localhost:3001');

    const estimacion = (await postJson(`${m4}/estimate`, {
        origin: { latitude: data.origen.latitude, longitude: data.origen.longitude },
        destination: { latitude: data.destino.latitude, longitude: data.destino.longitude },
    })).body;
    if (!positiveFiniteNumber(estimacion.distanceKm) || !positiveFiniteNumber(estimacion.estimatedEtaMinutes)) {
        throw new ErrorServicioFinalizacion('M4 devolvió una estimación de distancia o ETA inválida', 502);
    }

    const tarifa = (await postJson(`${m7}/tarifa/estimacion`, {
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
        tiempoEstimadoMin: estimacion.estimatedEtaMinutes,
        vehicleType: data.tipoVehiculo,
    })).body;
    if (typeof tarifa.estimatedFare !== 'number' || !Number.isFinite(tarifa.estimatedFare) || tarifa.estimatedFare < 0) {
        throw new ErrorServicioFinalizacion('M7 devolvió una tarifa estimada inválida', 502);
    }

    const registroPago = (await postJson(`${m7}/metodo-pago`, {
        clienteId: viaje.clienteId,
        viajeId: viaje.id,
        tipo: data.metodoPago,
    })).body;
    if (
        typeof registroPago.pagoId !== 'string' ||
        registroPago.pagoId.length === 0 ||
        registroPago.estado !== 'pendiente'
    ) {
        throw new ErrorServicioFinalizacion('M7 devolvió una respuesta inválida al registrar el método de pago', 502);
    }

    const autorizacion = (await postJson(
        `${m7}/metodo-pago/${encodeURIComponent(viaje.id)}/autorizar`,
        { idOrden: `ORD-${viaje.id}` },
    )).body;
    if (
        typeof autorizacion.pagoId !== 'string' ||
        autorizacion.pagoId.length === 0 ||
        autorizacion.estado !== 'autorizado'
    ) {
        throw new ErrorServicioFinalizacion('M7 no confirmó la autorización del pago', 502);
    }

    return {
        tiempoMinutos: estimacion.estimatedEtaMinutes,
        distanciaKm: estimacion.distanceKm,
        horaFin: data.horaFin,
        metodoPago: data.metodoPago,
        total: tarifa.estimatedFare,
        origen: data.origen,
        destino: data.destino,
        tipoVehiculo: data.tipoVehiculo,
        fuenteMetrica: 'M4',
        metricasEstimadas: true,
        paymentId: autorizacion.pagoId,
    };
}

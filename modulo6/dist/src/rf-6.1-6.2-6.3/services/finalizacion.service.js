import { llamadasDependencia, medir } from '../../observabilidad/metricas.js';
export class ErrorServicioFinalizacion extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'ErrorServicioFinalizacion';
    }
}
const configuredTimeoutMs = Number(process.env.M4_M7_TIMEOUT_MS);
const timeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? configuredTimeoutMs
    : 2500;
function baseUrl(environmentKey, defaultUrl) {
    const url = process.env[environmentKey] || defaultUrl;
    if (!url)
        throw new ErrorServicioFinalizacion(`Falta configurar ${environmentKey}`, 503);
    return url.replace(/\/+$/, '');
}
/** M7 protege /metodo-pago con una API key interna (RNF-10/RNF-11: se configura por entorno). */
function headersM7() {
    const apiKey = process.env.M7_API_KEY;
    return apiKey ? { 'x-api-key': apiKey } : {};
}
/** Llamada a otro módulo, medida en m6_dependencia_request_duration_seconds. */
function requestJson(destino, method, url, input, headers = {}, statusAceptados = []) {
    return medir(llamadasDependencia, destino, () => requestJsonSinMedir(method, url, input, headers, statusAceptados));
}
async function requestJsonSinMedir(method, url, input, headers, statusAceptados) {
    let response;
    try {
        response = await fetch(url, {
            method,
            headers: {
                ...(input !== undefined ? { 'content-type': 'application/json' } : {}),
                ...headers,
            },
            body: input !== undefined ? JSON.stringify(input) : undefined,
            signal: AbortSignal.timeout(timeoutMs),
        });
    }
    catch {
        throw new ErrorServicioFinalizacion(`Servicio externo no disponible: ${url}`, 503);
    }
    if (!response.ok && !statusAceptados.includes(response.status)) {
        throw new ErrorServicioFinalizacion(`El servicio externo respondió ${response.status}: ${url}`, response.status >= 500 ? 503 : 502);
    }
    let body;
    try {
        body = await response.json();
    }
    catch {
        throw new ErrorServicioFinalizacion(`Respuesta JSON inválida del servicio externo: ${url}`, 502);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ErrorServicioFinalizacion(`Respuesta inválida del servicio externo: ${url}`, 502);
    }
    return { status: response.status, body: body };
}
function positiveFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
/** Duración real del viaje: desde la transición a EN_CURSO hasta horaFin (mínimo 1 minuto). */
export function minutosTranscurridos(inicio, fin) {
    return Math.max(1, Math.ceil((fin.getTime() - inicio.getTime()) / 60_000));
}
/** Consulta el pago gestionado por M7 antes de completar el viaje. */
async function consultarPagoAutorizado(viaje, metodoPago) {
    const m7 = baseUrl('M7_URL');
    const respuesta = await requestJson({ dependencia: 'm7', operacion: 'consultar_pago' }, 'GET', `${m7}/metodo-pago/${encodeURIComponent(viaje.id)}`, undefined, headersM7(), [404]);
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
export async function ejecutarServiciosFinalizacion(viaje, data, inicio) {
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
    const pago = await consultarPagoAutorizado(viaje, data.metodoPago);
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

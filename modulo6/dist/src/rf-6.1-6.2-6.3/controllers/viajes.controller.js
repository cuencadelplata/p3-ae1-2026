import { EstadoViaje } from '../models/viaje.model.js';
import { generarQR, M8ApiError, validarQR } from '../services/qr.service.js';
import * as viajeRepo from '../repositories/viaje.repository.js';
import { randomUUID } from 'node:crypto';
import { consultarEstadoConductor } from '../services/conductor.service.js';
import { publicarEvento } from '../services/rabbitmq.service.js';
import { ejecutarServiciosFinalizacion, ErrorServicioFinalizacion, } from '../services/finalizacion.service.js';
import { despacharEventosPendientes } from '../services/eventos-viaje.service.js';
import { logger } from '../../observabilidad/logger.js';
import { consultasHistorial, duracionFinalizacion, finalizaciones } from '../../observabilidad/metricas.js';
class ErrorValidacionFinalizacion extends Error {
}
function qrVigente(viaje) {
    return Boolean(viaje.codigoVerificacion &&
        viaje.qrCode &&
        viaje.qrExpiresAt &&
        viaje.qrExpiresAt.getTime() > Date.now());
}
async function emitirYGuardarQR(viaje) {
    const qr = await generarQR(viaje.id);
    const expiresAt = new Date(qr.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
        throw new Error('M8 devolvió una fecha de expiración inválida');
    }
    await viajeRepo.actualizarQR(viaje.id, {
        token: qr.token,
        qrDataUrl: qr.qrDataUrl,
        expiresAt,
    });
    viaje.codigoVerificacion = qr.token;
    viaje.qrCode = qr.qrDataUrl;
    viaje.qrExpiresAt = expiresAt;
    return qr;
}
function respuestaQR(qr) {
    return { token: qr.token, qrDataUrl: qr.qrDataUrl, expiresAt: qr.expiresAt };
}
function parsePositiveInteger(value, nombre) {
    if (value === undefined || value === null || value === '')
        return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${nombre} debe ser un entero positivo`);
    }
    return parsed;
}
function obtenerHeaderIdempotency(req) {
    const raw = req.headers?.['idempotency-key'] ?? req.headers?.['Idempotency-Key'];
    if (Array.isArray(raw))
        return raw[0]?.trim() || undefined;
    return typeof raw === 'string' ? raw.trim() || undefined : undefined;
}
function viajeParaIntegracion(viaje) {
    return {
        id: viaje.id,
        clienteId: viaje.clienteId,
        clientUserId: viaje.clientUserId ?? null,
        conductorId: viaje.conductorId ?? null,
        driverUserId: viaje.driverUserId ?? null,
        rideRequestId: viaje.rideRequestId ?? null,
        idempotencyKey: viaje.idempotencyKey ?? null,
        origen: viaje.origen,
        destino: viaje.destino,
        codigoVerificacion: viaje.codigoVerificacion,
        fechaCreacion: viaje.fechaCreacion,
        estado: viaje.estado,
    };
}
/**
 * Viaje para otros módulos (GET /api/viajes/:id y respuesta de cancelación).
 * - M6 RF-6.5/6.6 usa id, clienteId, conductorId y estado.
 * - M2 importa direcciones de viajes completados: necesita origen, destino y completadoAt.
 * - El evento despacho.reabrir para M5 usa rideRequestId (el id de la solicitud en M5).
 */
function viajeRespuestaLegacy(viaje, completadoAt) {
    return {
        id: viaje.id,
        clienteId: viaje.clienteId,
        clientUserId: viaje.clientUserId ?? null,
        conductorId: viaje.conductorId ?? null,
        estado: viaje.estado,
        canceladoPor: viaje.canceladoPor ?? null,
        origen: viaje.origen,
        destino: viaje.destino,
        fechaCreacion: viaje.fechaCreacion,
        rideRequestId: viaje.rideRequestId ?? null,
        ...(completadoAt ? { completadoAt } : {}),
    };
}
//en este archivo definimos los controladores del modulo de viajes, que implementan la lógica de negocio para cada endpoint definido en las rutas. Cada controlador recibe la solicitud HTTP, valida los datos, interactúa con los servicios y repositorios necesarios, y devuelve la respuesta HTTP correspondiente.
export const solicitarViaje = async (req, res) => {
    const { clienteId, clientUserId, rideRequestId, origen, destino } = req.body;
    const idempotencyKey = obtenerHeaderIdempotency(req) ?? req.body?.idempotencyKey ?? req.body?.idempotency_key;
    if (typeof clienteId !== 'string' || !clienteId.trim()) {
        return res.status(400).json({ error: 'clienteId es obligatorio' });
    }
    if (origen === undefined || destino === undefined) {
        return res.status(400).json({ error: 'origen y destino son obligatorios' });
    }
    let parsedClientUserId = null;
    try {
        parsedClientUserId = parsePositiveInteger(clientUserId ?? req.body?.userId, 'clientUserId');
    }
    catch (error) {
        return res.status(400).json({ error: error.message });
    }
    const normalizedRideRequestId = typeof rideRequestId === 'string' && rideRequestId.trim() ? rideRequestId.trim() : undefined;
    const normalizedIdempotencyKey = typeof idempotencyKey === 'string' && idempotencyKey.trim() ? idempotencyKey.trim() : undefined;
    if (normalizedRideRequestId || normalizedIdempotencyKey) {
        const viajeDuplicado = await viajeRepo.buscarPorRideRequestId(normalizedRideRequestId, normalizedIdempotencyKey);
        if (viajeDuplicado) {
            return res.status(200).json(viajeParaIntegracion(viajeDuplicado));
        }
    }
    const id = randomUUID();
    const nuevoViaje = {
        id,
        clienteId: clienteId.trim(),
        clientUserId: parsedClientUserId,
        driverUserId: null,
        rideRequestId: normalizedRideRequestId ?? null,
        idempotencyKey: normalizedIdempotencyKey ?? null,
        estado: EstadoViaje.SOLICITADO,
        origen,
        destino,
        codigoVerificacion: null,
        qrCode: null,
        qrExpiresAt: null,
        fechaCreacion: new Date()
    };
    try {
        await viajeRepo.crear(nuevoViaje);
    }
    catch (error) {
        console.error('ERROR EN viajeRepo.crear:', error);
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }
    return res.status(201).json(viajeParaIntegracion(nuevoViaje));
};
export const obtenerViaje = async (req, res) => {
    const { id } = req.params;
    if (typeof id !== 'string') {
        return res.status(400).json({ error: 'Falta el id del viaje en la URL' });
    }
    let viaje;
    let completadoAt = null;
    try {
        viaje = await viajeRepo.buscarPorId(id);
        if (viaje?.estado === EstadoViaje.COMPLETADO) {
            completadoAt = await viajeRepo.buscarHoraFin(id);
        }
    }
    catch (error) {
        console.error('ERROR EN viajeRepo.buscarPorId:', error);
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }
    if (!viaje)
        return res.status(404).json({ error: 'Viaje no encontrado' });
    return res.json(viajeRespuestaLegacy(viaje, completadoAt));
};
export const cancelarViaje = async (req, res) => {
    const { id } = req.params;
    if (typeof id !== 'string') {
        return res.status(400).json({ error: 'Falta el id del viaje en la URL' });
    }
    const { actor, motivo } = req.body ?? {};
    if (actor !== 'cliente' && actor !== 'conductor') {
        return res.status(400).json({ error: 'El actor debe ser cliente o conductor' });
    }
    if (typeof motivo !== 'string' || !motivo.trim()) {
        return res.status(400).json({ error: 'El motivo de cancelación es obligatorio' });
    }
    let viaje;
    try {
        viaje = await viajeRepo.cancelarSiCancelable(id, actor, motivo.trim());
    }
    catch (error) {
        console.error('ERROR EN viajeRepo.cancelarSiCancelable:', error);
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }
    if (!viaje) {
        let viajeExistente;
        try {
            viajeExistente = await viajeRepo.buscarPorId(id);
        }
        catch (error) {
            console.error('ERROR EN viajeRepo.buscarPorId:', error);
            return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
        }
        if (!viajeExistente)
            return res.status(404).json({ error: 'Viaje no encontrado' });
        return res.status(400).json({
            error: `No se puede cancelar un viaje en estado ${viajeExistente.estado}`,
        });
    }
    // viaje.cancelado (M4) y TripCancelled (M8) quedaron en el outbox; se publican ahora o los reintenta el relay.
    void despacharEventosPendientes();
    return res.json(viajeRespuestaLegacy(viaje));
};
function validarCoordenadasFinalizacion(value, nombre) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ErrorValidacionFinalizacion(`${nombre} es obligatorio y debe contener coordenadas`);
    }
    const coordinates = value;
    const { latitude, longitude, address } = coordinates;
    if (typeof latitude !== 'number' ||
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        typeof longitude !== 'number' ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180) {
        throw new ErrorValidacionFinalizacion(`${nombre} debe tener latitud y longitud válidas`);
    }
    if (address !== undefined && typeof address !== 'string') {
        throw new ErrorValidacionFinalizacion(`${nombre}.address debe ser texto`);
    }
    return {
        latitude,
        longitude,
        ...(typeof address === 'string' ? { address } : {}),
    };
}
function validarDatosFinalizacion(input, inicio) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new ErrorValidacionFinalizacion('El cuerpo de la solicitud debe ser un objeto JSON');
    }
    const body = input;
    const origen = validarCoordenadasFinalizacion(body.origen, 'origen');
    const destino = validarCoordenadasFinalizacion(body.destino, 'destino');
    if (origen.latitude === destino.latitude && origen.longitude === destino.longitude) {
        throw new ErrorValidacionFinalizacion('El origen y el destino no pueden ser iguales');
    }
    if (body.tipoVehiculo !== 'auto' && body.tipoVehiculo !== 'moto') {
        throw new ErrorValidacionFinalizacion('tipoVehiculo debe ser auto o moto');
    }
    if (body.metodoPago !== 'efectivo' &&
        body.metodoPago !== 'tarjeta' &&
        body.metodoPago !== 'transferencia') {
        throw new ErrorValidacionFinalizacion('metodoPago debe ser efectivo, tarjeta o transferencia');
    }
    const horaFinRecibida = new Date(String(body.horaFin));
    if (Number.isNaN(horaFinRecibida.getTime()) ||
        horaFinRecibida.getTime() < inicio.getTime() - MARGEN_RELOJ_MS) {
        throw new ErrorValidacionFinalizacion('horaFin debe ser una fecha válida posterior al inicio del viaje');
    }
    // Un reloj del dispositivo apenas atrasado no debe impedir finalizar: se ajusta al inicio.
    const horaFin = horaFinRecibida < inicio ? new Date(inicio) : horaFinRecibida;
    if (horaFin.getTime() > Date.now() + MARGEN_RELOJ_MS) {
        throw new ErrorValidacionFinalizacion('horaFin no puede estar en el futuro');
    }
    return {
        origen,
        destino,
        tipoVehiculo: body.tipoVehiculo,
        horaFin,
        metodoPago: body.metodoPago,
    };
}
/** Tolerancia ante relojes desincronizados entre la app del conductor y el servidor. */
const MARGEN_RELOJ_MS = 2 * 60_000;
export const finalizarViaje = async (req, res) => {
    const { id } = req.params;
    if (typeof id !== 'string') {
        return res.status(400).json({ error: 'Falta el id del viaje en la URL' });
    }
    // RF-6.4 observable: métricas por resultado y un log por intento (sin datos de pago).
    const metodo = ['efectivo', 'tarjeta', 'transferencia'].includes(req.body?.metodoPago)
        ? String(req.body.metodoPago)
        : 'invalido';
    const finTimer = duracionFinalizacion.startTimer();
    const registrar = (resultado, extra = {}) => {
        finTimer({ resultado });
        finalizaciones.inc({ resultado, metodo_pago: metodo });
        const nivel = resultado === 'completado' || resultado === 'repetida' ? 'info' : 'warn';
        logger[nivel]({ evento: 'viaje.finalizacion', resultado, metodoPago: metodo, ...extra }, 'Finalización de viaje');
    };
    try {
        const result = await viajeRepo.finalizarSiEnCurso(id, async (viaje, inicio) => {
            const data = validarDatosFinalizacion(req.body, inicio);
            return ejecutarServiciosFinalizacion(viaje, data, inicio);
        });
        if (result.kind === 'not-found') {
            registrar('no_encontrado');
            return res.status(404).json({ error: 'Viaje no encontrado' });
        }
        if (result.kind === 'invalid-state') {
            registrar('estado_invalido', { estado: result.estado });
            return res.status(400).json({
                error: `No se puede finalizar un viaje en estado ${result.estado}`,
            });
        }
        const { viaje, finalizacion, repetida } = result;
        registrar(repetida ? 'repetida' : 'completado', {
            total: finalizacion.total,
            tiempoMinutos: finalizacion.tiempoMinutos,
            distanciaKm: finalizacion.distanciaKm,
            estadoPago: finalizacion.estadoPago,
        });
        if (!repetida) {
            // Publicación inmediata; si RabbitMQ falla, el relay periódico la reintenta.
            void despacharEventosPendientes();
        }
        const { paymentId, ...datosFinalizacion } = finalizacion;
        return res.json({
            viaje: {
                id: viaje.id,
                clienteId: viaje.clienteId,
                conductorId: viaje.conductorId ?? null,
                fechaCreacion: viaje.fechaCreacion,
                ...datosFinalizacion,
                estado: 'completado',
            },
            paymentId,
            estadoPago: finalizacion.estadoPago,
            metricasEstimadas: true,
            fuenteMetrica: 'M4',
            idempotente: repetida,
        });
    }
    catch (error) {
        if (error instanceof ErrorServicioFinalizacion) {
            registrar(error.status === 402 ? 'pago_rechazado' : 'error_dependencia', { causa: error.message });
            return res.status(error.status).json({ error: error.message });
        }
        if (error instanceof ErrorValidacionFinalizacion) {
            registrar('datos_invalidos', { causa: error.message });
            return res.status(400).json({ error: error.message });
        }
        registrar('error_interno');
        logger.error({ err: error }, 'Error inesperado al finalizar el viaje');
        return res.status(503).json({ error: 'No se pudo finalizar el viaje' });
    }
};
export const obtenerHistorialTransiciones = async (req, res) => {
    const { id } = req.params;
    if (typeof id !== 'string') {
        return res.status(400).json({ error: 'Falta el id del viaje en la URL' });
    }
    try {
        const result = await viajeRepo.buscarHistorialTransiciones(id);
        if (!result.exists) {
            consultasHistorial.inc({ tipo: 'viaje', resultado: 'no_encontrado' });
            return res.status(404).json({ error: 'Viaje no encontrado' });
        }
        consultasHistorial.inc({ tipo: 'viaje', resultado: 'ok' });
        return res.json({
            historial: result.historial.map((transicion) => ({
                from: viajeRepo.estadoHistorial(transicion.from),
                to: viajeRepo.estadoHistorial(transicion.to),
                timestamp: transicion.timestamp,
                ...(transicion.detalle ? { detalle: transicion.detalle } : {}),
            })),
        });
    }
    catch (error) {
        consultasHistorial.inc({ tipo: 'viaje', resultado: 'error' });
        logger.error({ err: error }, 'No se pudo consultar el historial de transiciones');
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }
};
function parametroTexto(value, nombre) {
    if (value === undefined || value === '')
        return undefined;
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 50) {
        throw new ErrorValidacionFinalizacion(`${nombre} debe ser un texto de hasta 50 caracteres`);
    }
    return value.trim();
}
function parametroEntero(value, nombre, defecto, min, max) {
    if (value === undefined || value === '')
        return defecto;
    const numero = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(numero) || numero < min || numero > max) {
        throw new ErrorValidacionFinalizacion(`${nombre} debe ser un entero entre ${min} y ${max}`);
    }
    return numero;
}
/** RF-6.7: GET /api/viajes?clienteId=&conductorId=&estado=&limit=&offset= */
export const listarRegistroViajes = async (req, res) => {
    let filtros;
    try {
        const estado = parametroTexto(req.query.estado, 'estado')?.toUpperCase();
        if (estado !== undefined && !Object.values(EstadoViaje).includes(estado)) {
            throw new ErrorValidacionFinalizacion(`estado debe ser uno de: ${Object.values(EstadoViaje).join(', ')}`);
        }
        filtros = {
            clienteId: parametroTexto(req.query.clienteId, 'clienteId'),
            conductorId: parametroTexto(req.query.conductorId, 'conductorId'),
            estado: estado,
            limit: parametroEntero(req.query.limit, 'limit', 20, 1, 100),
            offset: parametroEntero(req.query.offset, 'offset', 0, 0, 1_000_000),
        };
    }
    catch (error) {
        return res.status(400).json({ error: error.message });
    }
    try {
        const { total, viajes } = await viajeRepo.buscarRegistroViajes(filtros);
        consultasHistorial.inc({ tipo: 'registro', resultado: 'ok' });
        return res.json({ total, limit: filtros.limit, offset: filtros.offset, viajes });
    }
    catch (error) {
        consultasHistorial.inc({ tipo: 'registro', resultado: 'error' });
        logger.error({ err: error }, 'No se pudo consultar el registro de viajes');
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }
};
export const obtenerViajesDeCliente = async (req, res) => {
    const { clienteId } = req.params;
    if (typeof clienteId !== 'string' || !clienteId.trim()) {
        return res.status(400).json({ error: 'Falta el id del cliente en la URL' });
    }
    try {
        const viajes = await viajeRepo.buscarViajesPorCliente(clienteId);
        return res.json({ clienteId, viajes });
    }
    catch (error) {
        console.error('ERROR EN viajeRepo.buscarViajesPorCliente:', error);
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }
};
export const obtenerViajesDeConductor = async (req, res) => {
    const { conductorId } = req.params;
    if (typeof conductorId !== 'string' || !conductorId.trim()) {
        return res.status(400).json({ error: 'Falta el id del conductor en la URL' });
    }
    try {
        const viajes = await viajeRepo.buscarViajesPorConductor(conductorId);
        return res.json({ conductorId, viajes });
    }
    catch (error) {
        console.error('ERROR EN viajeRepo.buscarViajesPorConductor:', error);
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }
};
export const asignarConductor = async (req, res) => {
    const { id } = req.params;
    if (typeof id !== 'string') {
        return res.status(400).json({ error: 'Falta el id del viaje en la URL' });
    }
    const { conductorId, driverUserId } = req.body;
    let viaje;
    try {
        viaje = await viajeRepo.buscarPorId(id);
    }
    catch (error) {
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }
    if (!viaje)
        return res.status(404).json({ error: 'Viaje no encontrado' });
    if (viaje.estado !== EstadoViaje.SOLICITADO) {
        return res.status(400).json({ error: `No puedes asignar un conductor en este momento. Estado actual: ${viaje.estado}` });
    }
    let parsedDriverUserId = null;
    try {
        parsedDriverUserId = parsePositiveInteger(driverUserId ?? req.body?.userId, 'driverUserId');
    }
    catch (error) {
        return res.status(400).json({ error: error.message });
    }
    try {
        await viajeRepo.actualizarEstado(id, EstadoViaje.CONDUCTOR_EN_CAMINO, conductorId, parsedDriverUserId);
    }
    catch (error) {
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }
    viaje.conductorId = conductorId;
    viaje.driverUserId = parsedDriverUserId;
    viaje.estado = EstadoViaje.CONDUCTOR_EN_CAMINO;
    return res.json({ mensaje: 'Conductor asignado. Su conductor está en camino a su dirección', viaje: viajeParaIntegracion(viaje) });
};
export const registrarArribo = async (req, res) => {
    const { id } = req.params;
    if (typeof id !== 'string') {
        return res.status(400).json({
            error: 'Falta el id del viaje en la URL'
        });
    }
    let viaje;
    try {
        viaje = await viajeRepo.buscarPorId(id);
    }
    catch (error) {
        console.error('ERROR EN viajeRepo.buscarPorId:', error);
        return res.status(503).json({
            error: 'Base de datos no disponible, intente más tarde'
        });
    }
    if (!viaje) {
        return res.status(404).json({
            error: 'Viaje no encontrado'
        });
    }
    let reintentoQR = viaje.estado === EstadoViaje.ARRIBADO;
    if (!reintentoQR && viaje.estado !== EstadoViaje.CONDUCTOR_EN_CAMINO) {
        return res.status(400).json({
            error: `Transición inválida. El estado actual es ${viaje.estado}`
        });
    }
    if (!reintentoQR && !viaje.conductorId) {
        return res.status(400).json({
            error: 'El viaje no tiene conductor asignado'
        });
    }
    if (!reintentoQR) {
        try {
            const estadoConductor = await Promise.race([
                consultarEstadoConductor(viaje.conductorId),
                new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_M3')), 2000))
            ]);
            if (estadoConductor && estadoConductor.habilitado === false) {
                return res.status(403).json({ error: 'El conductor no está habilitado' });
            }
        }
        catch (error) {
            console.warn('Advertencia: Servicio M3 no disponible o lento, permitiendo arribo en E2E por resiliencia:', error);
        }
        let arriboActualizado;
        try {
            arriboActualizado = await viajeRepo.marcarArribado(id);
        }
        catch (error) {
            console.error('ERROR EN viajeRepo.marcarArribado:', error);
            return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
        }
        if (!arriboActualizado) {
            try {
                const viajeActual = await viajeRepo.buscarPorId(id);
                if (!viajeActual || viajeActual.estado !== EstadoViaje.ARRIBADO) {
                    return res.status(400).json({ error: 'El viaje ya no está disponible para registrar el arribo' });
                }
                viaje = viajeActual;
            }
            catch {
                return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
            }
        }
        else {
            viaje.estado = EstadoViaje.ARRIBADO;
            try {
                const occurredAt = new Date().toISOString();
                await publicarEvento('viajes_exchange', 'viaje.arribado', {
                    viajeId: id,
                    conductorId: viaje.conductorId,
                    fecha: occurredAt,
                });
                if (viaje.clientUserId) {
                    await publicarEvento('mobility.events', 'driver.arrived', {
                        messageId: randomUUID(),
                        eventType: 'DriverArrived',
                        version: 1,
                        occurredAt,
                        correlationId: id,
                        producer: 'm6',
                        data: { tripId: id, recipientId: viaje.clientUserId },
                    }, 'topic');
                }
            }
            catch (err) {
                console.error('Advertencia: No se pudo publicar evento de arribo', err);
            }
        }
    }
    let qr;
    try {
        qr = qrVigente(viaje) ? {
            token: viaje.codigoVerificacion,
            qrDataUrl: viaje.qrCode,
            expiresAt: viaje.qrExpiresAt.toISOString(),
        } : await emitirYGuardarQR(viaje);
    }
    catch (error) {
        if (error instanceof M8ApiError) {
            if (error.retryAfter)
                res.setHeader('Retry-After', error.retryAfter);
            return res.status(error.status >= 500 ? 503 : error.status)
                .json({ error: { code: error.code } });
        }
        console.error('ERROR EN generar/guardar QR:', error);
        return res.status(503).json({ error: 'No se pudo preparar el QR del viaje' });
    }
    return res.json({
        mensaje: 'El conductor ha arribado',
        viaje,
        qr: respuestaQR(qr),
    });
};
export const iniciarViaje = async (req, res) => {
    const { id } = req.params;
    if (typeof id !== 'string') {
        return res.status(400).json({ error: 'Falta el id del viaje en la URL' });
    }
    const codigoVerificacion = req.body.codigoVerificacion || req.body.token;
    let viaje;
    try {
        viaje = await viajeRepo.buscarPorId(id);
    }
    catch (error) {
        console.error('ERROR EN viajeRepo.buscarPorId:', error);
        return res.status(503).json({
            error: 'Base de datos no disponible, intente más tarde'
        });
    }
    if (!viaje)
        return res.status(404).json({ error: 'Viaje no encontrado' });
    if (viaje.estado !== EstadoViaje.ARRIBADO) {
        return res.status(400).json({ error: `No puedes iniciar el viaje en este momento. Estado actual: ${viaje.estado}` });
    }
    if (typeof codigoVerificacion !== 'string' ||
        codigoVerificacion.length === 0 ||
        (qrVigente(viaje) && codigoVerificacion !== viaje.codigoVerificacion)) {
        return res.status(401).json({ error: { code: 'QR_INVALID' } });
    }
    try {
        const resultado = await validarQR(id, codigoVerificacion);
        if (resultado.valid !== true) {
            return res.status(401).json({ error: { code: 'QR_INVALID' } });
        }
    }
    catch (error) {
        if (error instanceof M8ApiError) {
            const qrNeedsRefresh = (error.status === 409 && error.code === 'QR_ALREADY_USED') ||
                (error.status === 410 && error.code === 'QR_EXPIRED');
            if (qrNeedsRefresh) {
                let viajeActual;
                try {
                    viajeActual = await viajeRepo.buscarPorId(id);
                }
                catch {
                    return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
                }
                if (viajeActual?.estado === EstadoViaje.ARRIBADO) {
                    try {
                        const qrNuevo = await emitirYGuardarQR(viajeActual);
                        return res.status(error.status).json({
                            error: { code: error.code },
                            qr: respuestaQR(qrNuevo),
                        });
                    }
                    catch (refreshError) {
                        if (refreshError instanceof M8ApiError && refreshError.retryAfter) {
                            res.setHeader('Retry-After', refreshError.retryAfter);
                        }
                        return res.status(503).json({ error: { code: 'M8_UNAVAILABLE' } });
                    }
                }
            }
            if (error.retryAfter)
                res.setHeader('Retry-After', error.retryAfter);
            const status = error.status >= 500 ? 503 : error.status;
            return res.status(status).json({ error: { code: error.code } });
        }
        return res.status(503).json({ error: { code: 'M8_UNAVAILABLE' } });
    }
    try {
        const iniciado = await viajeRepo.iniciarSiArribado(id);
        if (!iniciado) {
            const estadoActual = await viajeRepo.buscarPorId(id);
            if (!estadoActual)
                return res.status(404).json({ error: 'Viaje no encontrado' });
            return res.status(400).json({
                error: `No puedes iniciar el viaje en este momento. Estado actual: ${estadoActual.estado}`,
            });
        }
        viaje = iniciado;
        // viaje.iniciado (trip.events) quedó en el outbox; se publica ahora o lo reintenta el relay.
        void despacharEventosPendientes();
    }
    catch (error) {
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }
    try {
        const occurredAt = new Date().toISOString();
        await publicarEvento('viajes_exchange', 'viaje.iniciado', {
            viajeId: id,
            fecha: occurredAt,
        });
        if (viaje.clientUserId) {
            await publicarEvento('mobility.events', 'trip.started', {
                messageId: randomUUID(),
                eventType: 'TripStarted',
                version: 1,
                occurredAt,
                correlationId: id,
                producer: 'm6',
                data: { tripId: id, recipientId: viaje.clientUserId },
            }, 'topic');
        }
    }
    catch (err) {
        console.error('Advertencia: No se pudo publicar evento de inicio', err);
    }
    return res.json({ mensaje: 'Viaje iniciado', viaje });
};

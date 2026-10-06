import type { Request, Response } from 'express';
import type { Viaje } from '../models/viaje.model.js';
import { EstadoViaje } from '../models/viaje.model.js';
import { generarQR, M8ApiError, validarQR, type GenerarQRResponse } from '../services/qr.service.js';
import * as viajeRepo from '../repositories/viaje.repository.js';
import { randomUUID } from 'node:crypto';
import { consultarEstadoConductor } from '../services/conductor.service.js';
import { publicarEvento } from '../services/rabbitmq.service.js';
import {
    ejecutarServiciosFinalizacion,
    ErrorServicioFinalizacion,
    type CoordenadasFinalizacion,
    type DatosFinalizacion,
} from '../services/finalizacion.service.js';
import { estadoHistorial } from '../repositories/viaje.repository.js';

class ErrorValidacionFinalizacion extends Error {}

function qrVigente(viaje: Viaje): boolean {
    return Boolean(
        viaje.codigoVerificacion &&
        viaje.qrCode &&
        viaje.qrExpiresAt &&
        viaje.qrExpiresAt.getTime() > Date.now()
    );
}

async function emitirYGuardarQR(viaje: Viaje): Promise<GenerarQRResponse> {
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

function respuestaQR(qr: GenerarQRResponse) {
    return { token: qr.token, qrDataUrl: qr.qrDataUrl, expiresAt: qr.expiresAt };
}

function viajeParaIntegracion(viaje: Viaje) {
    return {
        id: viaje.id,
        clienteId: viaje.clienteId,
        conductorId: viaje.conductorId ?? null,
        estado: viaje.estado,
    };
}

//en este archivo definimos los controladores del modulo de viajes, que implementan la lógica de negocio para cada endpoint definido en las rutas. Cada controlador recibe la solicitud HTTP, valida los datos, interactúa con los servicios y repositorios necesarios, y devuelve la respuesta HTTP correspondiente.
export const solicitarViaje = async (req: Request, res: Response): Promise<any> => {
    const { clienteId, origen, destino } = req.body;
    const id = randomUUID();

    const nuevoViaje: Viaje = {
        id,
        clienteId,
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
    } catch (error) {
        console.error('ERROR EN viajeRepo.crear:', error);
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }

    return res.status(201).json(nuevoViaje);
};

export const obtenerViaje = async (req: Request, res: Response): Promise<any> => {
    const { id } = req.params;
    if (typeof id !== 'string') {
        return res.status(400).json({ error: 'Falta el id del viaje en la URL' });
    }

    let viaje: Viaje | null;
    try {
        viaje = await viajeRepo.buscarPorId(id);
    } catch (error) {
        console.error('ERROR EN viajeRepo.buscarPorId:', error);
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }

    if (!viaje) return res.status(404).json({ error: 'Viaje no encontrado' });
    return res.json(viajeParaIntegracion(viaje));
};

export const cancelarViaje = async (req: Request, res: Response): Promise<any> => {
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

    let viaje: Viaje | null;
    try {
        viaje = await viajeRepo.cancelarSiCancelable(id, actor, motivo.trim());
    } catch (error) {
        console.error('ERROR EN viajeRepo.cancelarSiCancelable:', error);
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }

    if (!viaje) {
        let viajeExistente: Viaje | null;
        try {
            viajeExistente = await viajeRepo.buscarPorId(id);
        } catch (error) {
            console.error('ERROR EN viajeRepo.buscarPorId:', error);
            return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
        }
        if (!viajeExistente) return res.status(404).json({ error: 'Viaje no encontrado' });
        return res.status(400).json({
            error: `No se puede cancelar un viaje en estado ${viajeExistente.estado}`,
        });
    }

    return res.json(viajeParaIntegracion(viaje));
};

function validarCoordenadasFinalizacion(value: unknown, nombre: string): CoordenadasFinalizacion {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ErrorValidacionFinalizacion(`${nombre} es obligatorio y debe contener coordenadas`);
    }
    const coordinates = value as Record<string, unknown>;
    const { latitude, longitude, address } = coordinates;
    if (
        typeof latitude !== 'number' ||
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        typeof longitude !== 'number' ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
    ) {
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

function validarDatosFinalizacion(input: unknown, inicio: Date): DatosFinalizacion {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new ErrorValidacionFinalizacion('El cuerpo de la solicitud debe ser un objeto JSON');
    }
    const body = input as Record<string, unknown>;
    const origen = validarCoordenadasFinalizacion(body.origen, 'origen');
    const destino = validarCoordenadasFinalizacion(body.destino, 'destino');
    if (origen.latitude === destino.latitude && origen.longitude === destino.longitude) {
        throw new ErrorValidacionFinalizacion('El origen y el destino no pueden ser iguales');
    }
    if (body.tipoVehiculo !== 'auto' && body.tipoVehiculo !== 'moto') {
        throw new ErrorValidacionFinalizacion('tipoVehiculo debe ser auto o moto');
    }
    if (
        body.metodoPago !== 'efectivo' &&
        body.metodoPago !== 'tarjeta' &&
        body.metodoPago !== 'transferencia'
    ) {
        throw new ErrorValidacionFinalizacion('metodoPago debe ser efectivo, tarjeta o transferencia');
    }
    const horaFin = new Date(String(body.horaFin));
    if (Number.isNaN(horaFin.getTime()) || horaFin < inicio) {
        throw new ErrorValidacionFinalizacion('horaFin debe ser una fecha válida posterior al inicio del viaje');
    }
    return {
        origen,
        destino,
        tipoVehiculo: body.tipoVehiculo,
        horaFin,
        metodoPago: body.metodoPago,
    };
}

export const finalizarViaje = async (req: Request, res: Response): Promise<any> => {
    const { id } = req.params;
    if (typeof id !== 'string') {
        return res.status(400).json({ error: 'Falta el id del viaje en la URL' });
    }

    try {
        const result = await viajeRepo.finalizarSiEnCurso(id, async (viaje, inicio) => {
            const data = validarDatosFinalizacion(req.body, inicio);
            return ejecutarServiciosFinalizacion(viaje, data);
        });
        if (result.kind === 'not-found') return res.status(404).json({ error: 'Viaje no encontrado' });
        if (result.kind === 'invalid-state') {
            return res.status(400).json({
                error: `No se puede finalizar un viaje en estado ${result.estado}`,
            });
        }

        const { viaje, finalizacion } = result;
        const { paymentId, ...datosFinalizacion } = finalizacion;
        return res.json({
            viaje: {
                ...viaje,
                estado: 'completado',
                ...datosFinalizacion,
            },
            paymentId,
            metricasEstimadas: true,
            fuenteMetrica: 'M4',
        });
    } catch (error) {
        if (error instanceof ErrorServicioFinalizacion) {
            return res.status(error.status).json({ error: error.message });
        }
        if (error instanceof ErrorValidacionFinalizacion) {
            return res.status(400).json({ error: error.message });
        }
        console.error('ERROR EN finalizarViaje:', error);
        return res.status(503).json({ error: 'No se pudo finalizar el viaje' });
    }
};

export const obtenerHistorialTransiciones = async (req: Request, res: Response): Promise<any> => {
    const { id } = req.params;
    if (typeof id !== 'string') {
        return res.status(400).json({ error: 'Falta el id del viaje en la URL' });
    }

    try {
        const result = await viajeRepo.buscarHistorialTransiciones(id);
        if (!result.exists) return res.status(404).json({ error: 'Viaje no encontrado' });
        return res.json({
            historial: result.historial.map((transicion) => ({
                from: estadoHistorial(transicion.from),
                to: estadoHistorial(transicion.to),
                timestamp: transicion.timestamp,
                ...(transicion.detalle ? { detalle: transicion.detalle } : {}),
            })),
        });
    } catch (error) {
        console.error('ERROR EN viajeRepo.buscarHistorialTransiciones:', error);
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }
};

export const obtenerViajesDeCliente = async (req: Request, res: Response): Promise<any> => {
    const { clienteId } = req.params;
    if (typeof clienteId !== 'string' || !clienteId.trim()) {
        return res.status(400).json({ error: 'Falta el id del cliente en la URL' });
    }

    try {
        const viajes = await viajeRepo.buscarViajesPorCliente(clienteId);
        return res.json({ clienteId, viajes });
    } catch (error) {
        console.error('ERROR EN viajeRepo.buscarViajesPorCliente:', error);
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }
};

export const asignarConductor = async (req: Request, res: Response): Promise<any> => {
    const { id } = req.params;
    if (typeof id !== 'string') {
        return res.status(400).json({ error: 'Falta el id del viaje en la URL' });
    }
    const { conductorId } = req.body;

    let viaje;
    try {
        viaje = await viajeRepo.buscarPorId(id);
    } catch (error) {
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }

    if (!viaje) return res.status(404).json({ error: 'Viaje no encontrado' });
    if (viaje.estado !== EstadoViaje.SOLICITADO) {
        return res.status(400).json({ error: `No puedes asignar un conductor en este momento. Estado actual: ${viaje.estado}` });
    }

    try {
        await viajeRepo.actualizarEstado(id, EstadoViaje.CONDUCTOR_EN_CAMINO, conductorId);
    } catch (error) {
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }

    viaje.conductorId = conductorId;
    viaje.estado = EstadoViaje.CONDUCTOR_EN_CAMINO;
    return res.json({ mensaje: 'Conductor asignado. Su conductor está en camino a su dirección', viaje });
};

export const registrarArribo = async (req: Request, res: Response): Promise<any> => {
    const { id } = req.params;
    
    if (typeof id !== 'string') {
        return res.status(400).json({
            error: 'Falta el id del viaje en la URL'
        });
    }

    let viaje;

    try {
        viaje = await viajeRepo.buscarPorId(id);
    } catch (error) {
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
                consultarEstadoConductor(viaje.conductorId!),
                new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_M3')), 2000))
            ]) as any;

            if (estadoConductor && estadoConductor.habilitado === false) {
                return res.status(403).json({ error: 'El conductor no está habilitado' });
            }
        } catch (error) {
            console.warn('Advertencia: Servicio M3 no disponible o lento, permitiendo arribo en E2E por resiliencia:', error);
        }

        let arriboActualizado: boolean;
        try {
            arriboActualizado = await viajeRepo.marcarArribado(id);
        } catch (error) {
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
            } catch {
                return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
            }
        } else {
            viaje.estado = EstadoViaje.ARRIBADO;

            try {
                await publicarEvento('viajes_exchange', 'viaje.arribado', {
                    viajeId: id,
                    conductorId: viaje.conductorId,
                    fecha: new Date().toISOString()
                });
            } catch (err) {
                console.error('Advertencia: No se pudo publicar evento de arribo', err);
            }
        }
    }

    let qr: GenerarQRResponse;
    try {
        qr = qrVigente(viaje) ? {
            token: viaje.codigoVerificacion!,
            qrDataUrl: viaje.qrCode!,
            expiresAt: viaje.qrExpiresAt!.toISOString(),
        } : await emitirYGuardarQR(viaje);
    } catch (error) {
        if (error instanceof M8ApiError) {
            if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter);
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

export const iniciarViaje = async (req: Request, res: Response): Promise<any> => {
    const { id } = req.params;
    if (typeof id !== 'string') {
        return res.status(400).json({ error: 'Falta el id del viaje en la URL' });
    }
    const codigoVerificacion = req.body.codigoVerificacion || req.body.token;

    let viaje;
    try {
        viaje = await viajeRepo.buscarPorId(id);
    } catch (error) {
        console.error('ERROR EN viajeRepo.buscarPorId:', error);
        return res.status(503).json({
            error: 'Base de datos no disponible, intente más tarde'
        });
    }

    if (!viaje) return res.status(404).json({ error: 'Viaje no encontrado' });
    if (viaje.estado !== EstadoViaje.ARRIBADO) {
        return res.status(400).json({ error: `No puedes iniciar el viaje en este momento. Estado actual: ${viaje.estado}` });
    }

    if (
        typeof codigoVerificacion !== 'string' ||
        codigoVerificacion.length === 0 ||
        (qrVigente(viaje) && codigoVerificacion !== viaje.codigoVerificacion)
    ) {
        return res.status(401).json({ error: { code: 'QR_INVALID' } });
    }

    try {
        const resultado = await validarQR(id, codigoVerificacion);
        if (resultado.valid !== true) {
            return res.status(401).json({ error: { code: 'QR_INVALID' } });
        }
    } catch (error) {
        if (error instanceof M8ApiError) {
            if (error.status === 409 || error.status === 410) {
                let viajeActual: Viaje | null;
                try {
                    viajeActual = await viajeRepo.buscarPorId(id);
                } catch {
                    return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
                }

                if (viajeActual?.estado === EstadoViaje.ARRIBADO) {
                    try {
                        const qrNuevo = await emitirYGuardarQR(viajeActual);
                        return res.status(error.status).json({
                            error: { code: error.code },
                            qr: respuestaQR(qrNuevo),
                        });
                    } catch (refreshError) {
                        if (refreshError instanceof M8ApiError && refreshError.retryAfter) {
                            res.setHeader('Retry-After', refreshError.retryAfter);
                        }
                        return res.status(503).json({ error: { code: 'M8_UNAVAILABLE' } });
                    }
                }
            }
            if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter);
            const status = error.status >= 500 ? 503 : error.status;
            return res.status(status).json({ error: { code: error.code } });
        }
        return res.status(503).json({ error: { code: 'M8_UNAVAILABLE' } });
    }

    try {
        await viajeRepo.actualizarEstado(id, EstadoViaje.EN_CURSO);
    } catch (error) {
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }

    viaje.estado = EstadoViaje.EN_CURSO;

    try {
        await publicarEvento('viajes_exchange', 'viaje.iniciado', {
            viajeId: id,
            fecha: new Date().toISOString()
        });
    } catch (err) {
        console.error('Advertencia: No se pudo publicar evento de inicio', err);
    }

    return res.json({ mensaje: 'Viaje iniciado', viaje });
};
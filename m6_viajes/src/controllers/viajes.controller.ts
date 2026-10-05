import type { Request, Response } from 'express';
import type { Viaje } from '../models/viaje.model.js';
import { EstadoViaje } from '../models/viaje.model.js';
import { generarQR, M8ApiError, validarQR, type GenerarQRResponse } from '../services/qr.service.js';
import * as viajeRepo from '../repositories/viaje.repository.js';
import { randomUUID } from 'node:crypto';
import { consultarEstadoConductor } from '../services/conductor.service.js';
import { publicarEvento } from '../services/rabbitmq.service.js';

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
        viaje = await viajeRepo.cancelarSiCancelable(id);
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

    if (viaje.estado !== EstadoViaje.CONDUCTOR_EN_CAMINO) {
        return res.status(400).json({
            error: `Transición inválida. El estado actual es ${viaje.estado}`
        });
    }

    if (!viaje.conductorId) {
        return res.status(400).json({
            error: 'El viaje no tiene conductor asignado'
        });
    }

    try {
        const estadoConductor = await Promise.race([
            consultarEstadoConductor(viaje.conductorId),
            new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_M3')), 2000))
        ]) as any;

        if (estadoConductor && estadoConductor.habilitado === false) {
            return res.status(403).json({ error: 'El conductor no está habilitado' });
        }
    } catch (error) {
        console.warn('Advertencia: Servicio M3 no disponible o lento, permitiendo arribo en E2E por resiliencia:', error);
    }

    try {
        await viajeRepo.actualizarEstado(id, EstadoViaje.ARRIBADO);
    } catch (error) {
        console.error('ERROR EN viajeRepo.actualizarEstado:', error);
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }

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
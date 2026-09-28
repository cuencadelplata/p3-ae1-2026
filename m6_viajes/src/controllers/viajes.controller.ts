import type { Request, Response } from 'express';
import type { Viaje } from '../models/viaje.model.js';
import { EstadoViaje } from '../models/viaje.model.js';
import { generarQR, validarQR } from '../services/qr.service.js';
import * as viajeRepo from '../repositories/viaje.repository.js';
import { randomUUID } from 'node:crypto';
import { consultarEstadoConductor } from '../services/conductor.service.js';
import { publicarEvento } from '../services/rabbitmq.service.js';

export const solicitarViaje = async (req: Request, res: Response): Promise<any> => {
    const { clienteId, origen, destino } = req.body;
    const id = randomUUID();

    let codigoVerificacion: string;
    try {
        const respuesta = await generarQR(id);
        codigoVerificacion = respuesta.codigo;
    } catch (error) {
        console.error('ERROR EN generarQR:', error);
        return res.status(503).json({ error: 'Servicio de QR no disponible, intente más tarde' });
    }

    const nuevoViaje: Viaje = {
        id,
        clienteId,
        estado: EstadoViaje.SOLICITADO,
        origen,
        destino,
        codigoVerificacion,
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

    // RF-6.2: Antes de registrar el arribo, M6 consulta a M3
    try {
        const estadoConductor = await consultarEstadoConductor(
            viaje.conductorId
        );

        if (!estadoConductor.habilitado) {
            return res.status(403).json({
                error: 'El conductor no está habilitado'
            });
        }
    } catch (error) {
        console.error('ERROR EN consultarEstadoConductor:', error);
        return res.status(503).json({
            error: 'Servicio de conductores (M3) no disponible, intente más tarde'
        });
    }

    try {
        await viajeRepo.actualizarEstado(
            id,
            EstadoViaje.ARRIBADO
        );
    } catch (error) {
        console.error('ERROR EN viajeRepo.actualizarEstado:', error);
        return res.status(503).json({
            error: 'Base de datos no disponible, intente más tarde'
        });
    }

    viaje.estado = EstadoViaje.ARRIBADO;

    // RNF-07: Publicar evento asíncrono de arribo
    await publicarEvento('viajes_exchange', 'viaje.arribado', {
        viajeId: id,
        conductorId: viaje.conductorId,
        fecha: new Date().toISOString()
    });

    return res.json({
        mensaje: 'El conductor ha arribado',
        viaje
    });
};

export const iniciarViaje = async (req: Request, res: Response): Promise<any> => {
    const { id } = req.params;
    if (typeof id !== 'string') {
        return res.status(400).json({ error: 'Falta el id del viaje en la URL' });
    }
    const { codigoVerificacion } = req.body;

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

    try {
        const qrResponse = await validarQR(id, codigoVerificacion);
        
        if (!qrResponse.valido) {
            return res.status(401).json({ error: qrResponse.motivo || 'Código de verificación inválido' });
        }
    } catch (error: any) {
        // --- MANEJO DE RESILIENCIA (RNF-14) ---
        if (error.message.includes('503_SERVICE_UNAVAILABLE')) {
            return res.status(503).json({ 
                error: 'Servicio de validación temporalmente no disponible. Intente nuevamente.' 
            });
        }
        if (error.message.includes('400_BAD_REQUEST')) {
            return res.status(401).json({ 
                error: 'El código QR proporcionado es inválido o está expirado.' 
            });
        }
        
        console.error('Error no controlado en iniciarViaje:', error);
        return res.status(500).json({ error: 'Error interno del servidor al validar el QR.' });
    }

    try {
        await viajeRepo.actualizarEstado(id, EstadoViaje.EN_CURSO);
    } catch (error) {
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }

    viaje.estado = EstadoViaje.EN_CURSO;

    // RNF-07: Publicar evento asíncrono de inicio
    await publicarEvento('viajes_exchange', 'viaje.iniciado', {
        viajeId: id,
        fecha: new Date().toISOString()
    });

    return res.json({ mensaje: 'Viaje iniciado', viaje });
};
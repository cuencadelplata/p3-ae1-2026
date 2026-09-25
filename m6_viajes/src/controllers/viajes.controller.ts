import type { Request, Response } from 'express';
import type { Viaje } from '../models/viaje.model.js';
import { EstadoViaje } from '../models/viaje.model.js';
import { generarQR, validarQR } from '../services/qr.service.js';
import * as viajeRepo from '../repositories/viaje.repository.js';
import { randomUUID } from 'node:crypto';

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
        return res.status(400).json({ error: 'Falta el id del viaje en la URL' });
    }

    let viaje;
    try {
        viaje = await viajeRepo.buscarPorId(id);
    } catch (error) {
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }

    if (!viaje) return res.status(404).json({ error: 'Viaje no encontrado' });
    if (viaje.estado !== EstadoViaje.CONDUCTOR_EN_CAMINO) {
        return res.status(400).json({ error: `Transición inválida. El estado actual es ${viaje.estado}` });
    }

    try {
        await viajeRepo.actualizarEstado(id, EstadoViaje.ARRIBADO);
    } catch (error) {
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }

    viaje.estado = EstadoViaje.ARRIBADO;
    return res.json({ mensaje: 'El conductor ha arribado', viaje });
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
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }

    if (!viaje) return res.status(404).json({ error: 'Viaje no encontrado' });
    if (viaje.estado !== EstadoViaje.ARRIBADO) {
        return res.status(400).json({ error: `No puedes iniciar el viaje en este momento. Estado actual: ${viaje.estado}` });
    }

    try {
        const { valido, motivo } = await validarQR(id, codigoVerificacion);
        if (!valido) {
            return res.status(401).json({ error: motivo || 'Código de verificación inválido' });
        }
    } catch (error) {
        return res.status(503).json({ error: 'Servicio de QR no disponible, intente más tarde' });
    }

    try {
        await viajeRepo.actualizarEstado(id, EstadoViaje.EN_CURSO);
    } catch (error) {
        return res.status(503).json({ error: 'Base de datos no disponible, intente más tarde' });
    }

    viaje.estado = EstadoViaje.EN_CURSO;
    return res.json({ mensaje: 'Viaje iniciado', viaje });
};
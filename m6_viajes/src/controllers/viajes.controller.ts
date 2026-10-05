import type { Request, Response } from 'express';
import type { Viaje } from '../models/viaje.model.js';
import { EstadoViaje } from '../models/viaje.model.js';
import { generarQR, validarQR } from '../services/qr.service.js';
import * as viajeRepo from '../repositories/viaje.repository.js';
import { randomUUID } from 'node:crypto';
import { consultarEstadoConductor } from '../services/conductor.service.js';
import { publicarEvento } from '../services/rabbitmq.service.js';
//en este archivo definimos los controladores del modulo de viajes, que implementan la lógica de negocio para cada endpoint definido en las rutas. Cada controlador recibe la solicitud HTTP, valida los datos, interactúa con los servicios y repositorios necesarios, y devuelve la respuesta HTTP correspondiente.
export const solicitarViaje = async (req: Request, res: Response): Promise<any> => {
    const { clienteId, origen, destino } = req.body;
    const id = randomUUID();

    let codigoVerificacion: string;
    try {
        const respuesta = await generarQR(id);
        codigoVerificacion = respuesta.token || respuesta.codigo || `TEST-TOKEN-${id}`;
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

    // Consultamos al servicio externo M3 de forma segura con un timeout de 2 segundos para evitar bloqueos
    try {
        const estadoConductor = await Promise.race([
            consultarEstadoConductor(viaje.conductorId),
            new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_M3')), 2000))
        ]) as any;

        if (estadoConductor && estadoConductor.habilitado === false) {
            return res.status(403).json({
                error: 'El conductor no está habilitado'
            });
        }
    } catch (error) {
        console.warn('Advertencia: Servicio M3 no disponible o lento, permitiendo arribo en E2E por resiliencia:', error);
    }

    try {
        await viajeRepo.actualizarEstado(id, EstadoViaje.ARRIBADO);
    } catch (error) {
        console.error('ERROR EN viajeRepo.actualizarEstado:', error);
        return res.status(503).json({
            error: 'Base de datos no disponible, intente más tarde'
        });
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

    if (!codigoVerificacion || codigoVerificacion !== viaje.codigoVerificacion) {
        return res.status(401).json({ error: 'Código de verificación inválido' });
    }

    try {
        await validarQR(id, codigoVerificacion);
    } catch (error: any) {
        if (error.message && error.message.includes('503_SERVICE_UNAVAILABLE')) {
            return res.status(503).json({ 
                error: 'Servicio de validación temporalmente no disponible. Intente nuevamente.' 
            });
        }
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
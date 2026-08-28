import type { Request, Response } from 'express';
import type { Viaje } from '../models/viaje.model.js';
import { EstadoViaje } from '../models/viaje.model.js';

let viajesDb: Viaje[] = [];

// Funcion para resetear la BD de viajes  
export const resetViajesDb = () => {
    viajesDb = [];
};

export const solicitarViaje = (req: Request, res: Response): any => {
    const { clienteId, origen, destino } = req.body;
    
    const nuevoViaje: Viaje = {
        id: Date.now().toString(),
        clienteId,
        estado: EstadoViaje.SOLICITADO,
        origen,
        destino,
        codigoVerificacion: Math.random().toString(36).substring(2, 8).toUpperCase(),
        fechaCreacion: new Date()
    };

    viajesDb.push(nuevoViaje);
    return res.status(201).json(nuevoViaje);
};

export const registrarArribo = (req: Request, res: Response): any => {
    const { id } = req.params;
    const viaje = viajesDb.find(v => v.id === id);

    if (!viaje) {
        return res.status(404).json({ error: 'Viaje no encontrado' });
    }

    if (viaje.estado !== EstadoViaje.CONDUCTOR_EN_CAMINO) {
        return res.status(400).json({ 
            error: `Transición inválida. El estado actual es ${viaje.estado}` 
        });
    }

    viaje.estado = EstadoViaje.ARRIBADO;
    return res.json({ mensaje: 'El conductor ha arribado al punto de retiro', viaje });
};

// Asignar conductor y cambiar a CONDUCTOR_EN_CAMINO
export const asignarConductor = (req: Request, res: Response): any => {
    const { id } = req.params;
    const { conductorId } = req.body;
    
    const viaje = viajesDb.find(v => v.id === id);
    
    if (!viaje) {
        return res.status(404).json({ error: 'Viaje no encontrado' });
    }
    
    if (viaje.estado !== EstadoViaje.SOLICITADO) {
        return res.status(400).json({ error: `No puedes asignar. Estado actual: ${viaje.estado}` });
    }
    
    viaje.conductorId = conductorId;
    viaje.estado = EstadoViaje.CONDUCTOR_EN_CAMINO;
    return res.json({ mensaje: 'Conductor asignado. En camino al punto de retiro', viaje });
};

//  Validar cod de verificacion y cambiar a EN_CURSO
export const iniciarViaje = (req: Request, res: Response): any => {
    const { id } = req.params;
    const { codigoVerificacion } = req.body;
    
    const viaje = viajesDb.find(v => v.id === id);
    
    if (!viaje) {
        return res.status(404).json({ error: 'Viaje no encontrado' });
    }
    
    if (viaje.estado !== EstadoViaje.ARRIBADO) {
        return res.status(400).json({ error: `No puedes iniciar. Estado actual: ${viaje.estado}` });
    }
    
    if (viaje.codigoVerificacion !== codigoVerificacion) {
        return res.status(401).json({ error: 'Código de verificación inválido' });
    }
    
    viaje.estado = EstadoViaje.EN_CURSO;
    return res.json({ mensaje: 'Viaje iniciado. En movimiento', viaje });
};
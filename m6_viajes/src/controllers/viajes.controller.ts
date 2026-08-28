import type { Request, Response } from 'express';
import type { Viaje } from '../models/viaje.model.js';
import { EstadoViaje } from '../models/viaje.model.js';

const viajesDb: Viaje[] = [];

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
import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { findUserById } from "../repositories/user.repository";
import { guardarAltaVehiculo, listarAltasVehiculo } from "../repositories/alta-vehiculo.repository";

export function recibirAltaVehiculo(req: Request, res: Response): void {
    const usuarioId = Number(req.params.id);
    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
        res.status(400).json({ error: "El usuario de M1 tiene que ser numérico" });
        return;
    }

    const usuario = findUserById(usuarioId);
    if (!usuario) {
        res.status(404).json({ error: "El conductor no existe en M1" });
        return;
    }
    if (usuario.rol !== "CONDUCTOR") {
        res.status(409).json({ error: "El usuario de M1 no es conductor" });
        return;
    }

    const vehiculo = req.body?.vehiculo ?? null;
    const documentacion = Array.isArray(req.body?.documentacion) ? req.body.documentacion : null;
    if (!vehiculo || typeof vehiculo !== "object" || !documentacion) {
        res.status(400).json({ error: "Faltan el vehículo o la documentación" });
        return;
    }

    const guardada = guardarAltaVehiculo(usuarioId, vehiculo, documentacion);
    res.status(201).json(guardada);
}

export function listarAltasParaOperador(_req: AuthenticatedRequest, res: Response): void {
    res.status(200).json(listarAltasVehiculo());
}

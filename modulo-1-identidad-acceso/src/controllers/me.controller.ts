import { Request, Response } from "express";

import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { findUserById } from "../repositories/user.repository";
import { AuthError } from "../services/auth.service";
import {
    completarDatosPropios,
    obtenerPerfilPropio
} from "../services/user-profile.service";

// PATCH /auth/me: el usuario completa los datos que le faltan (DNI, teléfono, nombre, apellido).
// Pensado para quienes entraron con Google o Auth0. Un dato ya cargado no se modifica.
export function completarMiPerfil(
    req: AuthenticatedRequest,
    res: Response
): void {
    const userId = req.usuarioAutenticado?.userId;

    if (userId === undefined) {
        res.status(401).json({
            error: "Token requerido"
        });
        return;
    }

    try {
        res.status(200).json(completarDatosPropios(userId, req.body));
    } catch (error) {
        if (error instanceof AuthError) {
            res.status(error.statusCode).json({
                error: error.message
            });
            return;
        }

        console.error(error);

        res.status(500).json({
            error: "Error interno del servidor"
        });
    }
}

// GET /auth/me: devuelve los datos del usuario dueño del token.
// El userId sale del token ya validado, así que cada usuario solo puede ver sus propios datos.
export function obtenerMiPerfil(
    req: AuthenticatedRequest,
    res: Response
): void {
    const userId = req.usuarioAutenticado?.userId;

    if (userId === undefined) {
        res.status(401).json({
            error: "Token requerido"
        });
        return;
    }

    try {
        const perfil = obtenerPerfilPropio(userId);

        res.status(200).json(perfil);
    } catch (error) {
        if (error instanceof AuthError) {
            res.status(error.statusCode).json({
                error: error.message
            });
            return;
        }

        console.error(error);

        res.status(500).json({
            error: "Error interno del servidor"
        });
    }
}

// GET /auth/usuarios/:id/nombre: consulta interna entre servicios (ej. M8)
// autenticada con X-Internal-Api-Key. Devuelve únicamente { userId, nombre, apellido }.
export function obtenerNombreUsuarioInterno(
    req: Request,
    res: Response
): void {
    const rawId = String(req.params.id ?? "").trim();

    if (!/^\d+$/.test(rawId)) {
        res.status(400).json({
            error: "El id de usuario debe ser un entero positivo"
        });
        return;
    }

    const userId = Number(rawId);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        res.status(400).json({
            error: "El id de usuario debe ser un entero positivo"
        });
        return;
    }

    const usuario = findUserById(userId);
    if (!usuario) {
        res.status(404).json({
            error: "Usuario no encontrado"
        });
        return;
    }

    res.status(200).json({
        userId: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido
    });
}

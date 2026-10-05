import { Response } from "express";

import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { AuthError } from "../services/auth.service";
import { obtenerPerfilPropio } from "../services/user-profile.service";

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

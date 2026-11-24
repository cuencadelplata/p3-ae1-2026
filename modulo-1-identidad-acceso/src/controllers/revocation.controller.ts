import { Response } from "express";

import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { revocarCredenciales } from "../services/credential-revocation.service";
import { credencialesTotal } from "../metrics/metrics";

/**
 * RF-1.4: POST /auth/revocar-credenciales
 * Invalida todos los JWT que el usuario autenticado tenía emitidos
 */
export async function revokeCredentials(
    req: AuthenticatedRequest,
    res: Response
): Promise<void> {
    const userId = req.usuarioAutenticado?.userId;

    if (userId === undefined) {
        res.status(401).json({
            error: "Usuario no autenticado"
        });
        return;
    }

    try {
        const revocadasDesdeMs = await revocarCredenciales(
            userId,
            "SOLICITUD_DEL_USUARIO"
        );

        credencialesTotal.inc({ operacion: "credenciales_revocadas", resultado: "ok" });

        res.status(200).json({
            message: "Credenciales revocadas. Iniciá sesión nuevamente",
            userId,
            // En segundos, como antes; revocadasDesdeMs es el valor exacto.
            revocadasDesde: Math.floor(revocadasDesdeMs / 1000),
            revocadasDesdeMs
        });
    } catch (error) {
        console.error(error);

        credencialesTotal.inc({ operacion: "credenciales_revocadas", resultado: "error" });

        res.status(503).json({
            error: "No se pudieron revocar las credenciales. Intentá de nuevo más tarde"
        });
    }
}

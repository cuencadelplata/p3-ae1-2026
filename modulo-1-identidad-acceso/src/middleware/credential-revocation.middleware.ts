import {
    NextFunction,
    Request,
    Response
} from "express";
import jwt from "jsonwebtoken";

import { credencialFueRevocada } from "../services/credential-revocation.service";

// Corta el pedido si el JWT pertenece a un usuario que revocó sus credenciales
// después de que ese token fue emitido. La firma y el vencimiento los sigue
// validando authenticateToken: acá solo se mira de quién es y cuándo se generó.
export async function rechazarCredencialRevocada(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
        next();
        return;
    }

    const decoded = jwt.decode(
        authorization.slice("Bearer ".length)
    );

    if (
        !decoded ||
        typeof decoded === "string" ||
        typeof decoded.userId !== "number" ||
        typeof decoded.iat !== "number"
    ) {
        next();
        return;
    }

    try {
        const revocada = await credencialFueRevocada(
            decoded.userId,
            decoded.iat
        );

        if (revocada) {
            res.status(401).json({
                valid: false,
                error: "Credencial revocada"
            });
            return;
        }
    } catch (error) {
        // Si Redis no responde no se puede consultar la revocación: se deja pasar
        // para que el resto del módulo siga funcionando.
        console.error(
            "[Revocación] Redis no disponible, se omite el control:",
            (error as Error).message
        );
    }

    next();
}

import {
    NextFunction,
    Request,
    Response
} from "express";

import {
    MAX_INTENTOS_FALLIDOS,
    obtenerIntentosFallidos,
    segundosHastaDesbloqueo
} from "../services/login-attempts.service";

export function obtenerIpCliente(req: Request): string {
    return req.ip || req.socket.remoteAddress || "desconocida";
}

export async function loginRateLimit(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const ip = obtenerIpCliente(req);

    try {
        const intentos = await obtenerIntentosFallidos(ip);

        if (intentos >= MAX_INTENTOS_FALLIDOS) {
            const segundos = await segundosHastaDesbloqueo(ip);

            res.setHeader("Retry-After", String(segundos));
            res.status(429).json({
                error: "Demasiados intentos fallidos. Intentá de nuevo más tarde",
                retryAfterSeconds: segundos
            });
            return;
        }
    } catch (error) {
        // Fail-open: si Redis no responde, el login sigue funcionando sin límite.
        console.error(
            "[Rate limit] Redis no disponible, se omite el control:",
            (error as Error).message
        );
    }

    next();
}

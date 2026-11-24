import crypto from "crypto";
import { NextFunction, Request, Response } from "express";

// Autentica a M9 cuando pide un token delegado: Authorization: Bearer <credencial>.
// La credencial es un secreto compartido entre M1 (DELEGACION_M9_CREDENCIAL) y M9
// (M9_DISPATCH_AUTH_TOKEN). En el compose de integración las dos salen de la misma
// variable del .env de la raíz. Falla cerrado si no está configurada.
export function autenticarCredencialDelegacion(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const esperada = process.env.DELEGACION_M9_CREDENCIAL?.trim();

    if (!esperada) {
        res.status(503).json({
            error: "La emisión de tokens delegados no está configurada",
            code: "delegacion_no_configurada"
        });
        return;
    }

    const authorization = req.header("Authorization") ?? "";
    const recibida = authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length).trim()
        : "";

    const esperadaBuf = Buffer.from(esperada, "utf8");
    const recibidaBuf = Buffer.from(recibida, "utf8");

    if (
        !recibida ||
        esperadaBuf.length !== recibidaBuf.length ||
        !crypto.timingSafeEqual(esperadaBuf, recibidaBuf)
    ) {
        res.status(401).json({
            error: "Credencial de servicio inválida",
            code: "invalid_client"
        });
        return;
    }

    next();
}

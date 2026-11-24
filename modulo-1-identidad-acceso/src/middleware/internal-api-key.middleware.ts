import crypto from "crypto";
import { NextFunction, Request, Response } from "express";

// Autenticación entre servicios internos mediante cabecera X-Internal-Api-Key.
// La clave se configura en M1_INTERNAL_API_KEY (fail-closed si no está definida).
export function authenticateInternalApiKey(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const expectedKey = process.env.M1_INTERNAL_API_KEY?.trim();

    if (!expectedKey) {
        res.status(503).json({
            error: "Autenticación interna no configurada"
        });
        return;
    }

    const receivedHeader = req.header("X-Internal-Api-Key");
    if (!receivedHeader) {
        res.status(401).json({
            error: "Clave interna requerida"
        });
        return;
    }

    const expectedBuf = Buffer.from(expectedKey, "utf8");
    const receivedBuf = Buffer.from(receivedHeader, "utf8");

    if (
        expectedBuf.length !== receivedBuf.length ||
        !crypto.timingSafeEqual(expectedBuf, receivedBuf)
    ) {
        res.status(401).json({
            error: "Clave interna inválida"
        });
        return;
    }

    next();
}

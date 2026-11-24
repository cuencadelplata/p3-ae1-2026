import { Request, Response } from "express";

import { credencialesTotal } from "../metrics/metrics";
import {
    AUDIENCIA_DELEGADA,
    DelegationError,
    SCOPE_DELEGADO,
    emitirTokenDelegado
} from "../services/delegated-token.service";

// M9 manda el id como texto; también se acepta un número.
function leerClienteId(valor: unknown): number | null {
    const texto = typeof valor === "number" ? String(valor) : valor;

    if (typeof texto !== "string" || !/^[1-9]\d*$/.test(texto.trim())) {
        return null;
    }

    const id = Number(texto.trim());
    return Number.isSafeInteger(id) ? id : null;
}

/**
 * POST /auth/token-delegado
 * Body: { clientId, audience: "m5", scope: "ride-requests:write" }
 * Respuesta 200: { access_token, token_type, expires_in, audience, scope }
 */
export function emitirTokenDelegadoHandler(req: Request, res: Response): void {
    const { clientId, audience, scope } = req.body ?? {};
    const clienteId = leerClienteId(clientId);

    if (clienteId === null) {
        credencialesTotal.inc({ operacion: "token_delegado", resultado: "rechazado" });
        res.status(400).json({
            error: "clientId debe ser el id numérico del cliente en M1",
            code: "invalid_request"
        });
        return;
    }

    if (audience !== AUDIENCIA_DELEGADA || scope !== SCOPE_DELEGADO) {
        credencialesTotal.inc({ operacion: "token_delegado", resultado: "rechazado" });
        res.status(400).json({
            error: `Solo se emiten tokens con audience "${AUDIENCIA_DELEGADA}" y scope "${SCOPE_DELEGADO}"`,
            code: "invalid_scope"
        });
        return;
    }

    try {
        const token = emitirTokenDelegado(clienteId);

        credencialesTotal.inc({ operacion: "token_delegado", resultado: "ok" });
        res.setHeader("Cache-Control", "no-store");
        res.status(200).json(token);
    } catch (error) {
        if (error instanceof DelegationError) {
            credencialesTotal.inc({ operacion: "token_delegado", resultado: "rechazado" });
            res.status(error.statusCode).json({
                error: error.message,
                code: error.code
            });
            return;
        }

        console.error("[Token delegado] Error inesperado:", error);
        credencialesTotal.inc({ operacion: "token_delegado", resultado: "error" });
        res.status(500).json({
            error: "Error interno del servidor",
            code: "internal_server_error"
        });
    }
}

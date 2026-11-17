import {
    NextFunction,
    Request,
    Response
} from "express";

import { validacionesIdentidadTotal } from "../metrics/metrics";

// RF-1.3: cuenta los tokens rechazados (401) en GET /auth/validar-identidad-y-rol.
// Se monta en app.ts, antes de los routers, para contar también los que corta el
// middleware de revocación (RF-1.4) antes de llegar a la ruta.
export function contarValidacionRechazada(
    _req: Request,
    res: Response,
    next: NextFunction
): void {
    res.on("finish", () => {
        if (res.statusCode === 401) {
            validacionesIdentidadTotal.inc({ resultado: "token_rechazado" });
        }
    });

    next();
}

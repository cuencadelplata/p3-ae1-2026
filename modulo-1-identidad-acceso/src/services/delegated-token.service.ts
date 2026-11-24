import jwt from "jsonwebtoken";

import { getJwtSecret } from "../config/env";
import { findUserById } from "../repositories/user.repository";
import { marcaDeTiempoMs } from "../utils/reloj";

// Token delegado para M9 (reservas programadas).
//
// Cuando llega la hora de una reserva no hay ningún pasajero conectado: M9 le pide a M1
// un token de vida corta a nombre del cliente dueño de la reserva y con él crea la
// solicitud de viaje en M5. Es un JWT normal de M1 (userId + rol CLIENTE), así que M5 y
// /auth/validar-identidad-y-rol lo aceptan sin cambios. Además lleva:
//   sub    el cliente (M9 lo compara con el dueño de la reserva)
//   aud    "m5", el único destino previsto
//   scope  "ride-requests:write"
//   act    quién lo pidió en nombre del cliente (RFC 8693)
// M9 no guarda JWT de pasajeros: pide uno nuevo por cada activación.

export const AUDIENCIA_DELEGADA = "m5";
export const SCOPE_DELEGADO = "ride-requests:write";
export const ACTOR_DELEGACION = "m9-reservas-programadas";

const VIDA_POR_DEFECTO_SEGUNDOS = 300;

export class DelegationError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string
    ) {
        super(message);
        this.name = "DelegationError";
    }
}

export interface TokenDelegado {
    access_token: string;
    token_type: "Bearer";
    expires_in: number;
    audience: string;
    scope: string;
}

// Vida del token: 5 minutos por defecto, configurable entre 1 y 15 minutos.
// M9 exige que le queden más de 30 segundos al recibirlo.
export function vidaTokenDelegadoSegundos(): number {
    const configurada = Number(process.env.DELEGACION_TTL_SEGUNDOS);

    return Number.isInteger(configurada) && configurada >= 60 && configurada <= 900
        ? configurada
        : VIDA_POR_DEFECTO_SEGUNDOS;
}

export function emitirTokenDelegado(clienteId: number): TokenDelegado {
    const usuario = findUserById(clienteId);

    if (!usuario) {
        throw new DelegationError(404, "cliente_inexistente", "El cliente no existe");
    }

    // Solo pasajeros activos: no se emiten tokens delegados de conductores ni operadores.
    if (usuario.rol !== "CLIENTE" || usuario.estado !== "ACTIVO") {
        throw new DelegationError(
            403,
            "cliente_no_habilitado",
            "El usuario no es un cliente activo"
        );
    }

    const vida = vidaTokenDelegadoSegundos();

    const accessToken = jwt.sign(
        {
            userId: usuario.id,
            role: usuario.rol,
            authMethod: "delegated",
            scope: SCOPE_DELEGADO,
            act: { sub: ACTOR_DELEGACION },
            // Momento exacto de emisión, para la revocación (RF-1.4).
            iatMs: marcaDeTiempoMs()
        },
        getJwtSecret(),
        {
            subject: String(usuario.id),
            audience: AUDIENCIA_DELEGADA,
            expiresIn: vida,
            algorithm: "HS256"
        }
    );

    return {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: vida,
        audience: AUDIENCIA_DELEGADA,
        scope: SCOPE_DELEGADO
    };
}

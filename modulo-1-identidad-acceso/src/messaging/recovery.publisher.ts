import crypto from "crypto";
import {
    EXCHANGE_M1,
    obtenerCanal
} from "../config/rabbitmq";

// Eventos que M1 publica sobre recuperación y revocación (RF-1.4).
export const EVENTOS_RECUPERACION = {
    RECUPERACION_SOLICITADA: "auth.recuperacion_solicitada",
    CREDENCIALES_REVOCADAS: "auth.credenciales_revocadas"
} as const;

export type MotivoDeRevocacion =
    | "CAMBIO_DE_CONTRASENA"
    | "SOLICITUD_DEL_USUARIO";

async function publicarEvento(
    routingKey: string,
    datos: Record<string, unknown>
): Promise<void> {
    const mensaje = {
        // Identificador único: le sirve al consumidor para no procesar dos veces el mismo mensaje.
        id: crypto.randomUUID(),
        evento: routingKey,
        modulo: "M1",
        fecha: new Date().toISOString(),
        datos
    };

    const canal = await obtenerCanal();

    canal.publish(
        EXCHANGE_M1,
        routingKey,
        Buffer.from(JSON.stringify(mensaje)),
        {
            persistent: true,
            contentType: "application/json",
            messageId: mensaje.id
        }
    );
}

// El servicio de notificaciones lee este evento y envía el correo con el token.
export function publicarRecuperacionSolicitada(
    userId: number,
    email: string,
    nombre: string,
    token: string,
    expiraEnSegundos: number
): Promise<void> {
    return publicarEvento(
        EVENTOS_RECUPERACION.RECUPERACION_SOLICITADA,
        {
            userId,
            email,
            nombre,
            token,
            expiraEnSegundos
        }
    );
}

export function publicarCredencialesRevocadas(
    userId: number,
    motivo: MotivoDeRevocacion,
    revocadasDesde: number
): Promise<void> {
    return publicarEvento(
        EVENTOS_RECUPERACION.CREDENCIALES_REVOCADAS,
        {
            userId,
            motivo,
            revocadasDesde
        }
    );
}

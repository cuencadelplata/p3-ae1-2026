import {
    EXCHANGE_M1,
    obtenerCanal
} from "../config/rabbitmq";

// Nombres de los eventos que M1 publica sobre autenticación (RF-1.2).
export const EVENTOS_AUTH = {
    LOGIN_EXITOSO: "auth.login_exitoso",
    IP_BLOQUEADA: "auth.ip_bloqueada"
} as const;

function publicarEvento(
    routingKey: string,
    datos: Record<string, unknown>
): void {
    const mensaje = {
        evento: routingKey,
        modulo: "M1",
        fecha: new Date().toISOString(),
        datos
    };

    // No se usa await desde el controller: el login responde sin esperar a RabbitMQ.
    obtenerCanal()
        .then((canal) => {
            canal.publish(
                EXCHANGE_M1,
                routingKey,
                Buffer.from(JSON.stringify(mensaje)),
                {
                    persistent: true,
                    contentType: "application/json"
                }
            );
        })
        .catch((error) => {
            // Si RabbitMQ está caído, el login sigue funcionando igual.
            console.error(
                `[RabbitMQ] No se pudo publicar ${routingKey}:`,
                error.message
            );
        });
}

export function publicarLoginExitoso(
    userId: number,
    role: string
): void {
    publicarEvento(EVENTOS_AUTH.LOGIN_EXITOSO, {
        userId,
        role
    });
}

export function publicarIpBloqueada(
    ip: string,
    intentos: number,
    bloqueadaPorSegundos: number
): void {
    publicarEvento(EVENTOS_AUTH.IP_BLOQUEADA, {
        ip,
        intentos,
        bloqueadaPorSegundos
    });
}

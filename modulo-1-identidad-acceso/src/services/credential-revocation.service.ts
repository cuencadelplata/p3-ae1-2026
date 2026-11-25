import {
    guardarMomentoDeRevocacion,
    obtenerMomentoDeRevocacion
} from "../repositories/credential-revocation.repository";
import {
    MotivoDeRevocacion,
    publicarCredencialesRevocadas
} from "../messaging/recovery.publisher";
import { marcaDeTiempoMs } from "../utils/reloj";

// Cuándo se emitió un JWT, según sus claims.
export interface EmisionDelToken {
    // "iat" estándar: segundo en que se generó.
    iat: number;
    // Marca en milisegundos que agrega M1 al emitir (ver utils/reloj.ts).
    // Los tokens emitidos antes de este cambio no la tienen.
    iatMs?: number;
}

// Revoca todos los JWT que el usuario tenía emitidos hasta este momento.
// Devuelve el momento de la revocación en milisegundos.
export async function revocarCredenciales(
    userId: number,
    motivo: MotivoDeRevocacion
): Promise<number> {
    const revocadasDesdeMs = marcaDeTiempoMs();

    await guardarMomentoDeRevocacion(
        userId,
        revocadasDesdeMs
    );

    // Aviso asincrónico al resto de los módulos: no se espera a RabbitMQ.
    publicarCredencialesRevocadas(
        userId,
        motivo,
        revocadasDesdeMs
    ).catch((error) => {
        console.error(
            "[RabbitMQ] No se pudo publicar la revocación:",
            error.message
        );
    });

    return revocadasDesdeMs;
}

export async function credencialFueRevocada(
    userId: number,
    emision: EmisionDelToken
): Promise<boolean> {
    const revocadasDesdeMs =
        await obtenerMomentoDeRevocacion(userId);

    if (revocadasDesdeMs === null) {
        return false;
    }

    // Caso normal: el token trae su marca en milisegundos y la comparación es exacta,
    // aunque el token y la revocación hayan ocurrido en el mismo segundo.
    if (typeof emision.iatMs === "number") {
        return emision.iatMs < revocadasDesdeMs;
    }

    // Token sin iatMs (emitido por una versión anterior de M1): solo se sabe el segundo.
    // Ninguno de estos tokens pudo emitirse después de una revocación hecha con esta
    // versión, así que si cae en el mismo segundo que la revocación se lo trata como
    // anterior y se rechaza.
    return emision.iat * 1000 <= revocadasDesdeMs;
}

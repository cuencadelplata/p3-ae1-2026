import {
    guardarMomentoDeRevocacion,
    obtenerMomentoDeRevocacion
} from "../repositories/credential-revocation.repository";
import {
    MotivoDeRevocacion,
    publicarCredencialesRevocadas
} from "../messaging/recovery.publisher";

// Revoca todos los JWT que el usuario tenía emitidos hasta este momento.
export async function revocarCredenciales(
    userId: number,
    motivo: MotivoDeRevocacion
): Promise<number> {
    const ahoraEnSegundos = Math.floor(Date.now() / 1000);

    await guardarMomentoDeRevocacion(
        userId,
        ahoraEnSegundos
    );

    // Aviso asincrónico al resto de los módulos: no se espera a RabbitMQ.
    publicarCredencialesRevocadas(
        userId,
        motivo,
        ahoraEnSegundos
    ).catch((error) => {
        console.error(
            "[RabbitMQ] No se pudo publicar la revocación:",
            error.message
        );
    });

    return ahoraEnSegundos;
}

// emitidaEn es el campo "iat" del JWT: el segundo en que se generó.
export async function credencialFueRevocada(
    userId: number,
    emitidaEn: number
): Promise<boolean> {
    const revocadasDesde =
        await obtenerMomentoDeRevocacion(userId);

    if (revocadasDesde === null) {
        return false;
    }

    return emitidaEn < revocadasDesde;
}

import redis from "../config/redis";

// Debe coincidir con la duración del JWT que entrega el login (1 hora).
// Pasado ese tiempo los tokens viejos ya vencieron solos y la marca no hace falta.
export const VIDA_JWT_SEGUNDOS = 3600;

function claveDeRevocacion(userId: number): string {
    return `revocacion:usuario:${userId}`;
}

// Guarda el momento (en segundos) desde el cual los tokens anteriores no valen.
export async function guardarMomentoDeRevocacion(
    userId: number,
    momentoEnSegundos: number
): Promise<void> {
    await redis.set(
        claveDeRevocacion(userId),
        String(momentoEnSegundos),
        "EX",
        VIDA_JWT_SEGUNDOS
    );
}

export async function obtenerMomentoDeRevocacion(
    userId: number
): Promise<number | null> {
    const valor = await redis.get(
        claveDeRevocacion(userId)
    );

    return valor ? Number(valor) : null;
}

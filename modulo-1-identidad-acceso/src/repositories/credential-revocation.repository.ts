import redis from "../config/redis";

// Debe coincidir con la duración del JWT que entrega el login (1 hora).
// Pasado ese tiempo los tokens viejos ya vencieron solos y la marca no hace falta.
export const VIDA_JWT_SEGUNDOS = 3600;

// Por debajo de este valor la marca guardada está en segundos: así se guardaba
// antes de pasar a milisegundos. 1e11 ms es 1973; 1e11 s es el año 5138.
const LIMITE_MARCA_EN_SEGUNDOS = 100_000_000_000;

function claveDeRevocacion(userId: number): string {
    return `revocacion:usuario:${userId}`;
}

// Guarda el momento (en milisegundos) desde el cual los tokens anteriores no valen.
export async function guardarMomentoDeRevocacion(
    userId: number,
    momentoEnMs: number
): Promise<void> {
    await redis.set(
        claveDeRevocacion(userId),
        String(momentoEnMs),
        "EX",
        VIDA_JWT_SEGUNDOS
    );
}

// Devuelve el momento de revocación en milisegundos, o null si no hay.
export async function obtenerMomentoDeRevocacion(
    userId: number
): Promise<number | null> {
    const valor = await redis.get(
        claveDeRevocacion(userId)
    );

    if (!valor) {
        return null;
    }

    const momento = Number(valor);

    // Marca guardada por una versión anterior de M1 (en segundos).
    return momento < LIMITE_MARCA_EN_SEGUNDOS
        ? momento * 1000
        : momento;
}

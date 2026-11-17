import redis from "../config/redis";

// Cantidad de intentos fallidos permitidos dentro de la ventana de tiempo.
export const MAX_INTENTOS_FALLIDOS =
    Number(process.env.LOGIN_MAX_INTENTOS) || 5;

// Duración de la ventana en segundos. Pasado ese tiempo, el contador se borra solo.
export const VENTANA_SEGUNDOS =
    Number(process.env.LOGIN_VENTANA_SEGUNDOS) || 60;

function claveDeIp(ip: string): string {
    return `login:fallidos:${ip}`;
}

export async function obtenerIntentosFallidos(
    ip: string
): Promise<number> {
    const valor = await redis.get(claveDeIp(ip));

    return Number(valor) || 0;
}

export async function registrarIntentoFallido(
    ip: string
): Promise<number> {
    const clave = claveDeIp(ip);

    const intentos = await redis.incr(clave);

    // En el primer fallo arranca la ventana de tiempo.
    if (intentos === 1) {
        await redis.expire(clave, VENTANA_SEGUNDOS);
    }

    return intentos;
}

export async function reiniciarIntentos(
    ip: string
): Promise<void> {
    await redis.del(claveDeIp(ip));
}

export async function segundosHastaDesbloqueo(
    ip: string
): Promise<number> {
    const ttl = await redis.ttl(claveDeIp(ip));

    // ttl devuelve -1 o -2 si la clave no tiene vencimiento o no existe.
    return ttl > 0 ? ttl : VENTANA_SEGUNDOS;
}

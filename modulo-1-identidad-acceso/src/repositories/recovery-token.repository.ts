import crypto from "crypto";
import redis from "../config/redis";

// Tiempo de vida del token en Redis. Por defecto 15 minutos.
export const TTL_TOKEN_SEGUNDOS =
    Number(process.env.RECUPERACION_TTL_SEGUNDOS) || 900;

// En Redis no se guarda el token tal cual sino su hash: si alguien llegara a
// leer las claves, no podría usarlas para cambiar una contraseña.
function hashDeToken(token: string): string {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
}

function claveDeToken(hash: string): string {
    return `recuperacion:token:${hash}`;
}

function claveDeUsuario(userId: number): string {
    return `recuperacion:usuario:${userId}`;
}

export async function verificarConexion(): Promise<void> {
    await redis.ping();
}

export async function guardarTokenDeRecuperacion(
    userId: number,
    token: string
): Promise<void> {
    const hash = hashDeToken(token);

    // Si el usuario ya había pedido un token, el anterior deja de servir.
    const hashAnterior = await redis.get(claveDeUsuario(userId));

    if (hashAnterior) {
        await redis.del(claveDeToken(hashAnterior));
    }

    await redis.set(
        claveDeToken(hash),
        String(userId),
        "EX",
        TTL_TOKEN_SEGUNDOS
    );

    await redis.set(
        claveDeUsuario(userId),
        hash,
        "EX",
        TTL_TOKEN_SEGUNDOS
    );
}

// Devuelve el id del usuario dueño del token y lo borra en la misma operación.
// GETDEL es atómico: si llegan dos pedidos con el mismo token, solo uno lo obtiene.
export async function consumirTokenDeRecuperacion(
    token: string
): Promise<number | null> {
    const valor = await redis.getdel(
        claveDeToken(hashDeToken(token))
    );

    if (!valor) {
        return null;
    }

    const userId = Number(valor);

    await redis.del(claveDeUsuario(userId));

    return userId;
}

export async function segundosRestantesDelToken(
    token: string
): Promise<number> {
    return redis.ttl(
        claveDeToken(hashDeToken(token))
    );
}

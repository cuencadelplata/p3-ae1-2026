import Redis from "ioredis";

const redisUrl =
    process.env.REDIS_URL ||
    "redis://localhost:6379";

const redis = new Redis(redisUrl, {
    // No se conecta hasta el primer comando: así la API arranca aunque Redis no esté.
    lazyConnect: true,
    // Si Redis está caído, los comandos fallan rápido en vez de quedar esperando.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1
});

let ultimoErrorLogueado = 0;

redis.on("error", (error) => {
    // Evita llenar la consola: loguea como mucho un error cada 30 segundos.
    const ahora = Date.now();

    if (ahora - ultimoErrorLogueado > 30_000) {
        ultimoErrorLogueado = ahora;
        console.error(
            "[Redis] No se pudo conectar:",
            error.message
        );
    }
});

redis.connect().catch(() => {
    // El error ya lo informa el listener de arriba; ioredis reintenta solo.
});

export default redis;

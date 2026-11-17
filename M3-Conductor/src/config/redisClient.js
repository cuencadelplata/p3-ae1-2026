const Redis = require("ioredis");
require("dotenv").config();

const redisHost = process.env.REDIS_HOST || "localhost";
const redisPort = parseInt(process.env.REDIS_PORT || "6379", 10);
const redisPassword = process.env.REDIS_PASSWORD || undefined;

const redis = new Redis({
  host: redisHost,
  port: redisPort,
  password: redisPassword,
  connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || "1000", 10),
  commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT_MS || "500", 10),
  // Reconexión en segundo plano; con enableOfflineQueue=false los comandos fallan
  // de inmediato mientras no hay conexión, sin colgar las peticiones.
  retryStrategy: (times) => Math.min(times * 200, 2000),
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false
});

redis.on("connect", () => {
  console.log(`[Redis] Conectado exitosamente a ${redisHost}:${redisPort}`);
});

redis.on("error", (err) => {
  console.error(`[Redis] Error de conexión: ${err.message}`);
});

module.exports = redis;

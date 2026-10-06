const Redis = require("ioredis");
require("dotenv").config();

const redisHost = process.env.REDIS_HOST || "localhost";
const redisPort = parseInt(process.env.REDIS_PORT || "6379", 10);
const redisPassword = process.env.REDIS_PASSWORD || undefined;

const redis = new Redis({
  host: redisHost,
  port: redisPort,
  password: redisPassword,
  retryStrategy(times) {
    if (times > 1) return null;
    return 50;
  },
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

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
    const delay = Math.min(times * 200, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
});

redis.on("connect", () => {
  console.log(`[Redis] Conectado exitosamente a ${redisHost}:${redisPort}`);
});

redis.on("error", (err) => {
  console.error(`[Redis] Error de conexión: ${err.message}`);
});

module.exports = redis;

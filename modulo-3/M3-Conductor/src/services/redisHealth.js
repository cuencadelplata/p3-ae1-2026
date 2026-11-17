const redis = require("../config/redisClient");

const HEALTHCHECK_INTERVAL_MS = Number(
  process.env.REDIS_HEALTHCHECK_INTERVAL_MS || 10000
);

const CACHE_PATTERNS = [
  "conductor:*:habilitado",
  "conductor:*:disponible"
];

let up = true;
let healthTimer = null;

function isUp() {
  return up;
}

async function invalidatePattern(pattern) {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      100
    );
    cursor = String(nextCursor);
    if (keys && keys.length > 0) {
      if (typeof redis.unlink === "function") {
        await redis.unlink(...keys);
      } else if (typeof redis.del === "function") {
        await redis.del(...keys);
      }
    }
  } while (cursor !== "0");
}

async function invalidateConductorCache() {
  for (const pattern of CACHE_PATTERNS) {
    await invalidatePattern(pattern);
  }
}

async function healthcheckTick() {
  try {
    await redis.ping();
    await invalidateConductorCache();
    up = true;
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
    console.log("[Redis] Healthcheck OK: caché invalidada y servicio recuperado");
  } catch (err) {
    console.warn(`[Redis] Healthcheck falló: ${err.message}`);
  }
}

function markDown(err) {
  if (typeof redis.ping !== "function") {
    return;
  }

  const wasUp = up;
  up = false;

  if (wasUp) {
    console.warn(
      `[Redis] Marcado DOWN${err && err.message ? `: ${err.message}` : ""}`
    );
  }

  if (healthTimer) {
    return;
  }

  healthTimer = setInterval(healthcheckTick, HEALTHCHECK_INTERVAL_MS);
  if (healthTimer && typeof healthTimer.unref === "function") {
    healthTimer.unref();
  }
}

module.exports = {
  isUp,
  markDown
};

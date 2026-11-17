const redis = require("../config/redisClient");

const INTERVAL_MS = parseInt(process.env.REDIS_HEALTHCHECK_INTERVAL_MS || "10000", 10);

let up = true;
let timer = null;
let checking = false;

function isUp() {
  return up;
}

// Se llama ante el primer error/timeout de Redis. Mientras esté DOWN las
// peticiones van directo a la BD y una única tarea hace PING hasta recuperar.
function markDown(err) {
  // Sin ping (p. ej. Redis falso de los tests) no hay forma de recuperarse: no cambiar de estado.
  if (typeof redis.ping !== "function") return;
  if (!up) return;
  up = false;
  console.warn(`[RedisHealth] Redis DOWN, se usa la base de datos directamente: ${err && err.message}`);
  if (!timer) {
    timer = setInterval(check, INTERVAL_MS);
    timer.unref();
  }
}

// Al volver a UP las claves de caché pueden estar desactualizadas (se omitieron
// escrituras mientras estuvo DOWN): se invalidan para que se recarguen desde la BD.
async function invalidarCache() {
  if (typeof redis.scan !== "function") return;
  const borrar = typeof redis.unlink === "function" ? "unlink" : typeof redis.del === "function" ? "del" : null;
  if (!borrar) return;
  try {
    for (const patron of ["conductor:*:habilitado", "conductor:*:disponible"]) {
      let cursor = "0";
      do {
        const [siguiente, claves] = await redis.scan(cursor, "MATCH", patron, "COUNT", 100);
        cursor = siguiente;
        if (claves.length > 0) await redis[borrar](...claves);
      } while (cursor !== "0");
    }
  } catch (err) {
    console.warn(`[RedisHealth] No se pudo invalidar la caché tras recuperar Redis: ${err.message}`);
  }
}

async function check() {
  if (checking || up) return;
  checking = true;
  try {
    await redis.ping();
    await invalidarCache();
    up = true;
    clearInterval(timer);
    timer = null;
    console.log("[RedisHealth] Redis UP, se retoma el uso de la caché");
  } catch (err) {
    // sigue DOWN; se reintenta en el próximo ciclo
  } finally {
    checking = false;
  }
}

module.exports = { isUp, markDown };

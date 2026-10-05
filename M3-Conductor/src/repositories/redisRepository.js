const redis = require("../config/redisClient");
const conductorDBRepository = require("./conductorDBRepository");
const { mockConductores, mockValoraciones } = require("../mocks/mockData");

// Fallback en memoria por si Redis no está activo momentáneamente
const inMemoryConductores = new Map();
const inMemoryValoraciones = [];
// Fallback en memoria puro para el estado efímero de disponibilidad (RF 3.3)
const inMemoryDisponibilidad = new Map();

// Inicializar mocks en memoria por defecto
mockConductores.forEach((c) => inMemoryConductores.set(c.usuarioID, c));
mockValoraciones.forEach((v) => inMemoryValoraciones.push(v));

// TTL (segundos) del caché de habilitación (RF 3.1). Al vencer, el próximo GET
// vuelve a consultar la base de datos y recarga la caché.
const TTL_HABILITADO = parseInt(process.env.REDIS_TTL_HABILITADO || "300", 10);
// TTL (segundos) de la marca de disponibilidad (RF 3.3). Es un "heartbeat": si el
// conductor no refresca su estado antes de que expire, deja de figurar disponible.
const TTL_DISPONIBLE = parseInt(process.env.REDIS_TTL_DISPONIBLE || "60", 10);

const keyHabilitado = (id) => `conductor:${id}:habilitado`;
const keyDisponible = (id) => `conductor:${id}:disponible`;

/**
 * Inicializa los datos mock en Redis si la base está vacía.
 */
async function seedRedisIfEmpty() {
  try {
    const exists = await redis.exists("conductores:ids");
    if (!exists) {
      console.log("[Redis] Sembrando datos mock en Redis...");

      for (const c of mockConductores) {
        await redis.sadd("conductores:ids", c.usuarioID);
        await redis.set(`conductor:${c.usuarioID}`, JSON.stringify(c));
        // Semilla del estado efímero de disponibilidad (RF 3.3) a partir de
        // estado_conexion, con el mismo TTL tipo heartbeat que usa el resto del flujo.
        await redis.set(
          keyDisponible(c.usuarioID),
          JSON.stringify({ disponible: c.estado_conexion === "conectado" }),
          "EX",
          TTL_DISPONIBLE
        );
      }

      for (const v of mockValoraciones) {
        await redis.rpush(`conductor:${v.conductorId}:valoraciones`, JSON.stringify(v));
      }

      console.log("[Redis] Mocks sembrados con éxito.");
    }
  } catch (err) {
    console.warn(`[Redis Seed] No se pudo conectar a Redis (${err.message}). Usando fallback en memoria.`);
  }
}

/**
 * Obtener todos los conductores
 */
async function obtenerConductores() {
  try {
    const ids = await redis.smembers("conductores:ids");
    if (ids && ids.length > 0) {
      const conductores = [];
      for (const id of ids) {
        const raw = await redis.get(`conductor:${id}`);
        if (raw) conductores.push(JSON.parse(raw));
      }
      return conductores;
    }
  } catch (err) {
    console.warn(`[Redis] Fallo al listar conductores, usando memoria: ${err.message}`);
  }
  return Array.from(inMemoryConductores.values());
}

/**
 * Obtener conductor por ID
 */
async function obtenerConductorPorId(id) {
  try {
    const raw = await redis.get(`conductor:${id}`);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn(`[Redis] Fallo al buscar conductor por ID, usando memoria: ${err.message}`);
  }
  return inMemoryConductores.get(id) || null;
}

/**
 * Crear un nuevo conductor
 */
async function crearConductor(datos) {
  const nuevoConductor = {
    usuarioID: datos.usuarioID || `cond_${Date.now()}`,
    ciudad: datos.ciudad || "No especificada",
    tipovehiculo: datos.tipovehiculo || "auto",
    licenciaId: datos.licenciaId || "",
    vehiculoId: datos.vehiculoId || "",
    habilitado: datos.habilitado || "pendiente",
    estado_conexion: datos.estado_conexion || "desconectado",
    createdAt: new Date().toISOString()
  };

  try {
    await redis.sadd("conductores:ids", nuevoConductor.usuarioID);
    await redis.set(`conductor:${nuevoConductor.usuarioID}`, JSON.stringify(nuevoConductor));
    await redis.set(
      keyDisponible(nuevoConductor.usuarioID),
      JSON.stringify({ disponible: nuevoConductor.estado_conexion === "conectado" }),
      "EX",
      TTL_DISPONIBLE
    );
  } catch (err) {
    console.warn(`[Redis] Fallo al persistir en Redis, guardando en memoria: ${err.message}`);
  }

  inMemoryConductores.set(nuevoConductor.usuarioID, nuevoConductor);
  return nuevoConductor;
}

/**
 * RF 3.1 - Obtener el estado de habilitación de un conductor (patrón cache-aside).
 *
 * 1) Intenta leer `conductor:{id}:habilitado` en Redis.
 * 2) Si no está en caché (o Redis falla), consulta la base de datos (única fuente
 *    de verdad para este dato) y guarda el resultado en Redis con TTL.
 *
 * Este es el único punto por el que cualquier otro módulo debe consultar la
 * habilitación de un conductor: así se evita que hagan SELECT directos contra
 * la base de datos y se garantiza que la mayoría de las lecturas resuelven en
 * Redis (O(1)), no en la base de datos.
 *
 * @returns {Promise<{ usuarioID: string, habilitado: string, origen: 'cache'|'db' } | null>}
 */
async function obtenerHabilitado(id) {
  try {
    const raw = await redis.get(keyHabilitado(id));
    if (raw) {
      return { ...JSON.parse(raw), origen: "cache" };
    }
  } catch (err) {
    console.warn(`[Redis] Fallo al leer caché de habilitación, se consulta la base de datos: ${err.message}`);
  }

  // Cache miss: la base de datos es la fuente de verdad para este dato (RF 3.1)
  const desdeDB = await conductorDBRepository.obtenerHabilitadoPorId(id);
  if (!desdeDB) {
    return null;
  }

  const resultado = { usuarioID: desdeDB.usuarioID, habilitado: desdeDB.habilitado };
  try {
    await redis.set(keyHabilitado(id), JSON.stringify(resultado), "EX", TTL_HABILITADO);
  } catch (err) {
    console.warn(`[Redis] Fallo al guardar en caché la habilitación de '${id}': ${err.message}`);
  }

  return { ...resultado, origen: "db" };
}

/**
 * RF 3.3 - Obtener el estado efímero de disponibilidad de un conductor.
 *
 * A diferencia de la habilitación, la disponibilidad NUNCA se persiste en la
 * base de datos: vive solo en Redis mientras el conductor está conectado
 * (clave con TTL tipo heartbeat). Si la clave no existe -ya sea porque nunca
 * se seteó o porque expiró por falta de heartbeat- se considera no disponible.
 *
 * Al no depender de la base de datos, esta consulta queda optimizada (una sola
 * lectura en Redis) para que el Módulo 5 (matching/asignación de viajes) la
 * pueda invocar con alta frecuencia sin generar carga sobre la base de datos.
 *
 * @returns {Promise<{ usuarioID: string, disponible: boolean }>}
 */
async function obtenerDisponibilidad(id) {
  try {
    const raw = await redis.get(keyDisponible(id));
    if (raw) {
      const { disponible } = JSON.parse(raw);
      return { usuarioID: id, disponible: Boolean(disponible) };
    }
  } catch (err) {
    console.warn(`[Redis] Fallo al leer disponibilidad, usando fallback en memoria: ${err.message}`);
    const enMemoria = inMemoryDisponibilidad.get(id);
    if (enMemoria !== undefined) {
      return { usuarioID: id, disponible: enMemoria };
    }
  }

  // Sin clave vigente en Redis = sin heartbeat reciente = no disponible
  return { usuarioID: id, disponible: false };
}

/**
 * Setter de soporte para RF 3.3: refresca el heartbeat de disponibilidad de un
 * conductor en Redis. Pensado para que el propio Módulo 3 (al conectar/desconectar
 * un conductor) actualice este estado efímero; no se expone como endpoint propio
 * en este cambio, que se limita a los dos GET solicitados.
 */
async function actualizarDisponibilidad(id, disponible) {
  const valor = { usuarioID: id, disponible: Boolean(disponible) };
  try {
    await redis.set(keyDisponible(id), JSON.stringify(valor), "EX", TTL_DISPONIBLE);
  } catch (err) {
    console.warn(`[Redis] Fallo al actualizar disponibilidad de '${id}', usando memoria: ${err.message}`);
  }
  inMemoryDisponibilidad.set(id, Boolean(disponible));
  return valor;
}

/**
 * Obtener valoraciones de un conductor
 */
async function obtenerValoraciones(conductorId) {
  try {
    const lista = await redis.lrange(`conductor:${conductorId}:valoraciones`, 0, -1);
    if (lista && lista.length > 0) {
      return lista.map((item) => JSON.parse(item));
    }
  } catch (err) {
    console.warn(`[Redis] Fallo al leer valoraciones de Redis: ${err.message}`);
  }

  return inMemoryValoraciones.filter((v) => v.conductorId === conductorId);
}

/**
 * Registrar una valoración para un conductor
 */
async function registrarValoracion(datos) {
  const nuevaValoracion = {
    id: `val_${Date.now()}`,
    usuarioId: datos.usuarioId,
    conductorId: datos.conductorId,
    valoracion: Number(datos.valoracion),
    comentario: datos.comentario || "",
    fecha: new Date().toISOString()
  };

  try {
    await redis.rpush(
      `conductor:${nuevaValoracion.conductorId}:valoraciones`,
      JSON.stringify(nuevaValoracion)
    );
  } catch (err) {
    console.warn(`[Redis] Fallo al guardar valoración en Redis: ${err.message}`);
  }

  inMemoryValoraciones.push(nuevaValoracion);
  return nuevaValoracion;
}

module.exports = {
  seedRedisIfEmpty,
  obtenerConductores,
  obtenerConductorPorId,
  crearConductor,
  obtenerValoraciones,
  registrarValoracion,
  obtenerHabilitado,
  obtenerDisponibilidad,
  actualizarDisponibilidad
};

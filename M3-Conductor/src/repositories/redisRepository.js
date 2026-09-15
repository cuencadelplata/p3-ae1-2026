const redis = require("../config/redisClient");
const { mockConductores, mockValoraciones } = require("../mocks/mockData");

// Fallback en memoria por si Redis no está activo momentáneamente
const inMemoryConductores = new Map();
const inMemoryValoraciones = [];

// Inicializar mocks en memoria por defecto
mockConductores.forEach((c) => inMemoryConductores.set(c.usuarioID, c));
mockValoraciones.forEach((v) => inMemoryValoraciones.push(v));

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
  } catch (err) {
    console.warn(`[Redis] Fallo al persistir en Redis, guardando en memoria: ${err.message}`);
  }

  inMemoryConductores.set(nuevoConductor.usuarioID, nuevoConductor);
  return nuevoConductor;
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
  registrarValoracion
};

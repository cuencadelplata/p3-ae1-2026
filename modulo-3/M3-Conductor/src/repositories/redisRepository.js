const redis = require("../config/redisClient");
const conductorDBRepository = require("./conductorDBRepository");
const redisHealth = require("../services/redisHealth");

// Fallback en memoria por si Redis no está activo momentáneamente.
// Arranca vacío: no se siembran datos mock, solo lo que llega por la API.
const inMemoryConductores = new Map();
const inMemoryValoraciones = [];
// Fallback en memoria puro para el estado efímero de disponibilidad (RF 3.3)
const inMemoryDisponibilidad = new Map();

// TTL (segundos) del caché de habilitación (RF 3.1). Al vencer, el próximo GET
// vuelve a consultar la base de datos y recarga la caché.
const TTL_HABILITADO = parseInt(process.env.REDIS_TTL_HABILITADO || "300", 10);
// TTL (segundos) de la marca de disponibilidad (RF 3.3). Es un "heartbeat": si el
// conductor no refresca su estado antes de que expire, deja de figurar disponible.
const TTL_DISPONIBLE = parseInt(process.env.REDIS_TTL_DISPONIBLE || "60", 10);

const keyHabilitado = (id) => `conductor:${id}:habilitado`;
const keyDisponible = (id) => `conductor:${id}:disponible`;

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
  return inMemoryConductores.get(id) || conductorDBRepository.obtenerPerfilPorId(id);
}

async function asegurarPerfilConductor(id) {
  const existente = await obtenerConductorPorId(id);
  if (existente) return existente;

  const perfil = {
    usuarioID: id,
    ciudad: "No especificada",
    tipovehiculo: "auto",
    licenciaId: "",
    vehiculoId: "",
    habilitado: "pendiente",
    estado_conexion: "desconectado",
    createdAt: new Date().toISOString()
  };
  await conductorDBRepository.crearConductor(perfil, { conservarExistente: true });
  const guardado = await conductorDBRepository.obtenerPerfilPorId(id);
  if (!guardado) throw new Error("No se pudo recuperar el perfil registrado.");
  try {
    await redis.set(`conductor:${id}`, JSON.stringify(guardado), "NX");
    await redis.sadd("conductores:ids", id);
  } catch (err) {
    console.warn(`[Redis] Fallo al cachear el alta de '${id}': ${err.message}`);
  }
  return obtenerConductorPorId(id);
}

async function obtenerPendientesDeHabilitacion() {
  const [locales, persistidos] = await Promise.all([
    obtenerConductores(),
    conductorDBRepository.obtenerPendientes()
  ]);
  const perfiles = new Map(persistidos.map(perfil => [perfil.usuarioID, perfil]));
  for (const perfil of locales) perfiles.set(perfil.usuarioID, perfil);
  return Array.from(perfiles.values()).filter(perfil => perfil.habilitado === "pendiente");
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

  // Fuente de verdad de la habilitación (RF 3.1)
  await conductorDBRepository.crearConductor(nuevoConductor);

  inMemoryConductores.set(nuevoConductor.usuarioID, nuevoConductor);
  return nuevoConductor;
}

/**
 * Cambia el tipo de vehículo de un conductor ya creado (mismo destino que
 * crearConductor: Redis con fallback en memoria). Devuelve null si no existe.
 */
async function actualizarTipoVehiculo(id, tipovehiculo) {
  const actual = await obtenerConductorPorId(id);
  if (!actual) {
    return null;
  }

  const actualizado = { ...actual, tipovehiculo, updatedAt: new Date().toISOString() };
  try {
    await redis.set(`conductor:${id}`, JSON.stringify(actualizado));
  } catch (err) {
    console.warn(`[Redis] Fallo al actualizar tipo de vehículo de '${id}', guardando en memoria: ${err.message}`);
  }
  inMemoryConductores.set(id, actualizado);
  return actualizado;
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
  if (redisHealth.isUp()) try {
    const raw = await redis.get(keyHabilitado(id));
    if (raw) {
      return { ...JSON.parse(raw), origen: "cache" };
    }
  } catch (err) {
    redisHealth.markDown(err);
    console.warn(`[Redis] Fallo al leer caché de habilitación, se consulta la base de datos: ${err.message}`);
  }

  // Cache miss: la base de datos es la fuente de verdad para este dato (RF 3.1)
  const desdeDB = await conductorDBRepository.obtenerHabilitadoPorId(id);
  if (!desdeDB) {
    return null;
  }

  const resultado = { usuarioID: desdeDB.usuarioID, habilitado: desdeDB.habilitado };
  if (redisHealth.isUp()) try {
    await redis.set(keyHabilitado(id), JSON.stringify(resultado), "EX", TTL_HABILITADO);
  } catch (err) {
    redisHealth.markDown(err);
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
  if (redisHealth.isUp()) try {
    const raw = await redis.get(keyDisponible(id));
    if (raw) {
      const { disponible } = JSON.parse(raw);
      return { usuarioID: id, disponible: Boolean(disponible) };
    }
    // Redis UP y sin clave = heartbeat vencido = no disponible. Si la BD aún dice
    // true, se sincroniza a false (sin re-cachear ni emitir evento).
    try {
      const desdeDB = await conductorDBRepository.obtenerDisponiblePorId(id);
      if (desdeDB && desdeDB.disponible) {
        await conductorDBRepository.actualizarDisponible(id, false);
      }
    } catch (err) {
      console.warn(`[DB] Fallo al sincronizar disponibilidad vencida de '${id}': ${err.message}`);
    }
    inMemoryDisponibilidad.set(id, false);
    return { usuarioID: id, disponible: false };
  } catch (err) {
    redisHealth.markDown(err);
    console.warn(`[Redis] Fallo al leer disponibilidad, se consulta la base de datos: ${err.message}`);
  }

  // Redis caído: la BD (columna `disponible`) es la fuente
  let disponible;
  try {
    const desdeDB = await conductorDBRepository.obtenerDisponiblePorId(id);
    if (desdeDB) disponible = Boolean(desdeDB.disponible);
  } catch (err) {
    console.warn(`[DB] Fallo al leer disponibilidad de '${id}': ${err.message}`);
  }
  if (disponible === undefined) {
    disponible = inMemoryDisponibilidad.get(id) === true;
  }
  return { usuarioID: id, disponible };
}

/**
 * RF 3.3 - Refresca el heartbeat de disponibilidad de un conductor en Redis
 * (nunca en la base de datos). Devuelve también el valor anterior para que el
 * controller sepa si hubo un cambio real y deba emitir DriverAvailabilityUpdated.
 *
 * @returns {Promise<{ usuarioID: string, disponible: boolean, disponibleAnterior: boolean }>}
 */
async function actualizarDisponibilidad(id, disponible) {
  const { disponible: disponibleAnterior } = await obtenerDisponibilidad(id);
  const valor = { usuarioID: id, disponible: Boolean(disponible) };
  if (redisHealth.isUp()) try {
    await redis.set(keyDisponible(id), JSON.stringify(valor), "EX", TTL_DISPONIBLE);
  } catch (err) {
    redisHealth.markDown(err);
    console.warn(`[Redis] Fallo al actualizar disponibilidad de '${id}': ${err.message}`);
  }
  // La BD se escribe solo cuando el valor cambió (no en cada heartbeat)
  if (valor.disponible !== disponibleAnterior) {
    try {
      await conductorDBRepository.actualizarDisponible(id, valor.disponible);
    } catch (err) {
      console.warn(`[DB] Fallo al persistir disponibilidad de '${id}': ${err.message}`);
    }
  }
  inMemoryDisponibilidad.set(id, Boolean(disponible));
  return { ...valor, disponibleAnterior };
}

/**
 * RF 3.1 - Actualiza la habilitación de un conductor (write-through).
 *
 * 1) Escribe en la base de datos (fuente de verdad).
 * 2) Refresca la caché `conductor:{id}:habilitado` con TTL para que las
 *    lecturas posteriores no devuelvan un valor viejo.
 *
 * @returns {Promise<{ usuarioID: string, habilitado: string, habilitadoAnterior: string } | null>}
 */
async function actualizarHabilitado(id, habilitado) {
  const resultado = await conductorDBRepository.actualizarHabilitado(id, habilitado);
  if (!resultado) {
    return null;
  }

  if (redisHealth.isUp()) try {
    await redis.set(
      keyHabilitado(id),
      JSON.stringify({ usuarioID: id, habilitado }),
      "EX",
      TTL_HABILITADO
    );
  } catch (err) {
    redisHealth.markDown(err);
    console.warn(`[Redis] Fallo al refrescar la caché de habilitación de '${id}': ${err.message}`);
  }

  // Mantener sincronizado el registro completo (lo usa GET /conductor/:id/estado)
  if (redisHealth.isUp()) try {
    const raw = await redis.get(`conductor:${id}`);
    const perfil = raw ? JSON.parse(raw) : await conductorDBRepository.obtenerPerfilPorId(id);
    if (perfil) {
      await redis.set(`conductor:${id}`, JSON.stringify({ ...perfil, habilitado }));
    }
  } catch (err) {
    redisHealth.markDown(err);
    console.warn(`[Redis] Fallo al actualizar el registro de '${id}': ${err.message}`);
  }

  const conductor = inMemoryConductores.get(id);
  if (conductor) {
    inMemoryConductores.set(id, { ...conductor, habilitado });
  }

  return resultado;
}

/**
 * Obtener valoraciones hechas por un conductor (evaluador) sobre pasajeros.
 * @param {string} evaluadorId - usuarioID del conductor que valoró
 */
async function obtenerValoraciones(evaluadorId) {
  try {
    const lista = await redis.lrange(
      `conductor:${evaluadorId}:valoraciones`,
      0,
      -1
    );
    if (lista && lista.length > 0) {
      return lista.map((item) => JSON.parse(item));
    }
  } catch (err) {
    console.warn(`[Redis] Fallo al leer valoraciones de Redis: ${err.message}`);
  }

  return inMemoryValoraciones.filter(
    (v) => (v.evaluadorId || v.conductorId) === evaluadorId
  );
}

/**
 * Registrar una valoración: conductor (evaluador) → pasajero (evaluado).
 */
async function registrarValoracion(datos) {
  const evaluadorId = datos.evaluadorId || datos.conductorId;
  const evaluadoId = datos.evaluadoId || datos.clienteId || datos.usuarioId;

  const nuevaValoracion = {
    id: `val_${Date.now()}`,
    evaluadorId,
    evaluadoId,
    valoracion: Number(datos.valoracion),
    comentario: datos.comentario || "",
    viajeId: datos.viajeId || null,
    fecha: new Date().toISOString()
  };

  try {
    await redis.rpush(
      `conductor:${nuevaValoracion.evaluadorId}:valoraciones`,
      JSON.stringify(nuevaValoracion)
    );
  } catch (err) {
    console.warn(`[Redis] Fallo al guardar valoración en Redis: ${err.message}`);
  }

  inMemoryValoraciones.push(nuevaValoracion);
  return nuevaValoracion;
}

async function guardarValoracionPendiente(valoracion) {
  const clave = `valoracion:pendiente:${valoracion.viajeId}`;
  await redis.set(clave, JSON.stringify(valoracion));
  return valoracion;
}

async function listarValoracionesPendientes() {
  const claves = [];
  let cursor = "0";

  do {
    const [siguiente, encontradas] = await redis.scan(
      cursor,
      "MATCH",
      "valoracion:pendiente:*",
      "COUNT",
      50
    );
    cursor = siguiente;
    claves.push(...encontradas);
  } while (cursor !== "0");

  if (claves.length === 0) {
    return [];
  }

  const valores = await redis.mget(...claves);
  return valores.filter(Boolean).map((item) => JSON.parse(item));
}

module.exports = {
  obtenerConductores,
  obtenerPendientesDeHabilitacion,
  obtenerConductorPorId,
  asegurarPerfilConductor,
  crearConductor,
  actualizarTipoVehiculo,
  obtenerValoraciones,
  registrarValoracion,
  obtenerHabilitado,
  obtenerDisponibilidad,
  actualizarDisponibilidad,
  actualizarHabilitado,
  guardarValoracionPendiente,
  listarValoracionesPendientes
};

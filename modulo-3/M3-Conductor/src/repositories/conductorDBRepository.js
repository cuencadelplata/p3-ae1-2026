const getSupabaseClient = require("../config/SupabaseClient");

// Fallback en memoria: se usa cuando Supabase no está configurado (desarrollo/tests)
// o cuando la consulta a la base de datos falla. Arranca VACÍO (sin datos mock):
// solo contiene conductores dados de alta por POST /api/conductores.
// Es la ÚNICA puerta de entrada a la base de datos del módulo: ningún otro módulo
// debe tocar la tabla `conductores` directamente, siempre deben pasar por la API
// REST de M3 (ver conductoresController).
const inMemoryDB = new Map();

const camposPerfil = "usuario_id, ciudad, tipo_vehiculo, licencia_id, vehiculo_id, habilitado, created_at";

function perfilDesdeDB(data) {
  return {
    usuarioID: data.usuario_id,
    ciudad: data.ciudad,
    tipovehiculo: data.tipo_vehiculo,
    licenciaId: data.licencia_id || "",
    vehiculoId: data.vehiculo_id || "",
    habilitado: data.habilitado,
    estado_conexion: "desconectado",
    createdAt: data.created_at
  };
}

async function obtenerPerfilPorId(id) {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase.from("conductores").select(camposPerfil).eq("usuario_id", id).maybeSingle();
    if (error) throw error;
    if (data) return perfilDesdeDB(data);
  }
  return inMemoryDB.get(id) || null;
}

async function obtenerPendientes() {
  const supabase = getSupabaseClient();
  if (!supabase) return Array.from(inMemoryDB.values()).filter(perfil => perfil.habilitado === "pendiente");

  const { data, error } = await supabase.from("conductores").select(camposPerfil).eq("habilitado", "pendiente");
  if (error) throw error;
  return data.map(perfilDesdeDB);
}

/**
 * Alta (idempotente) de un conductor en la base de datos persistente. Sin esto,
 * un conductor creado por la API no tenía habilitación consultable (RF 3.1)
 * apenas faltaba en la caché de Redis.
 *
 * @param {{ usuarioID: string, ciudad: string, tipovehiculo: string, licenciaId?: string, vehiculoId?: string, habilitado?: string }} datos
 */
async function crearConductor(datos, { conservarExistente = false } = {}) {
  const registro = {
    usuarioID: datos.usuarioID,
    ciudad: datos.ciudad,
    tipovehiculo: datos.tipovehiculo,
    licenciaId: datos.licenciaId || "",
    vehiculoId: datos.vehiculoId || "",
    habilitado: datos.habilitado || "pendiente",
    disponible: datos.estado_conexion === "conectado",
    createdAt: datos.createdAt
  };

  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      const { error } = await supabase.from("conductores").upsert(
        {
          usuario_id: registro.usuarioID,
          ciudad: registro.ciudad,
          tipo_vehiculo: registro.tipovehiculo,
          licencia_id: registro.licenciaId || null,
          vehiculo_id: registro.vehiculoId || null,
          habilitado: registro.habilitado,
          updated_at: new Date().toISOString()
        },
        conservarExistente ? { onConflict: "usuario_id", ignoreDuplicates: true } : { onConflict: "usuario_id" }
      );

      if (error) throw error;
    } catch (err) {
      if (conservarExistente) throw err;
      console.warn(
        `[DB] Fallo al dar de alta a '${registro.usuarioID}' en Supabase, usando fallback en memoria: ${err.message}`
      );
    }
  }

  if (conservarExistente && inMemoryDB.has(registro.usuarioID)) {
    return inMemoryDB.get(registro.usuarioID);
  }
  inMemoryDB.set(registro.usuarioID, { ...(inMemoryDB.get(registro.usuarioID) || {}), ...registro });
  return registro;
}

/**
 * Obtiene el estado de habilitación (RF 3.1) de un conductor directamente desde
 * la base de datos persistente (tabla `conductores`), sin pasar por Redis.
 * Es la función que usa el repositorio de Redis cuando hay un "cache miss".
 *
 * @param {string} id - usuarioID del conductor
 * @returns {Promise<{ usuarioID: string, habilitado: string } | null>}
 */
async function obtenerHabilitadoPorId(id) {
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("conductores")
        .select("usuario_id, habilitado")
        .eq("usuario_id", id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        return { usuarioID: data.usuario_id, habilitado: data.habilitado };
      }
      return null;
    } catch (err) {
      console.warn(
        `[DB] Fallo al consultar habilitación de '${id}' en Supabase, usando fallback en memoria: ${err.message}`
      );
    }
  }

  const conductor = inMemoryDB.get(id);
  return conductor ? { usuarioID: conductor.usuarioID, habilitado: conductor.habilitado } : null;
}

/**
 * Actualiza el estado de habilitación (RF 3.1) de un conductor en la base de
 * datos persistente.
 *
 * @param {string} id - usuarioID del conductor
 * @param {string} habilitado - nuevo estado ('pendiente' | 'activo' | 'suspendido' | 'rechazado')
 * @returns {Promise<{ usuarioID: string, habilitado: string, habilitadoAnterior: string } | null>}
 *          null si el conductor no existe
 */
async function actualizarHabilitado(id, habilitado) {
  const anterior = await obtenerHabilitadoPorId(id);
  if (!anterior) {
    return null;
  }

  const supabase = getSupabaseClient();

  if (supabase) {
    const { error } = await supabase
      .from("conductores")
      .update({ habilitado, updated_at: new Date().toISOString() })
      .eq("usuario_id", id);
    if (error) throw error;
  }

  const conductor = inMemoryDB.get(id);
  if (conductor) {
    inMemoryDB.set(id, { ...conductor, habilitado });
  }

  return { usuarioID: id, habilitado, habilitadoAnterior: anterior.habilitado };
}

/**
 * Lee la disponibilidad (RF 3.3) persistida en la columna `disponible`.
 * @returns {Promise<{ usuarioID: string, disponible: boolean } | null>}
 */
async function obtenerDisponiblePorId(id) {
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("conductores")
        .select("usuario_id, disponible")
        .eq("usuario_id", id)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        return { usuarioID: data.usuario_id, disponible: Boolean(data.disponible) };
      }
      return null;
    } catch (err) {
      console.warn(
        `[DB] Fallo al consultar disponibilidad de '${id}' en Supabase, usando fallback en memoria: ${err.message}`
      );
    }
  }

  const conductor = inMemoryDB.get(id);
  return conductor
    ? { usuarioID: conductor.usuarioID, disponible: conductor.disponible === true }
    : null;
}

/**
 * Persiste la disponibilidad (RF 3.3). Solo se invoca cuando el valor cambia.
 */
async function actualizarDisponible(id, disponible) {
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      const { error } = await supabase
        .from("conductores")
        .update({ disponible, updated_at: new Date().toISOString() })
        .eq("usuario_id", id);

      if (error) throw error;
    } catch (err) {
      console.warn(
        `[DB] Fallo al actualizar disponibilidad de '${id}' en Supabase, usando fallback en memoria: ${err.message}`
      );
    }
  }

  const conductor = inMemoryDB.get(id);
  if (conductor) {
    inMemoryDB.set(id, { ...conductor, disponible });
  }
  return { usuarioID: id, disponible };
}

module.exports = {
  crearConductor,
  obtenerPerfilPorId,
  obtenerPendientes,
  obtenerDisponiblePorId,
  actualizarDisponible,
  obtenerHabilitadoPorId,
  actualizarHabilitado
};

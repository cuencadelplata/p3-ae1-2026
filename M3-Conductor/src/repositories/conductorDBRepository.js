const getSupabaseClient = require("../config/SupabaseClient");
const { mockConductores } = require("../mocks/mockData");

// Fallback en memoria: se usa cuando Supabase no está configurado (desarrollo/tests)
// o cuando la consulta a la base de datos falla. Es la ÚNICA puerta de entrada a
// la base de datos del módulo: ningún otro módulo debe tocar la tabla `conductores`
// directamente, siempre deben pasar por la API REST de M3 (ver conductoresController).
const inMemoryDB = new Map(mockConductores.map((c) => [c.usuarioID, c]));

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

module.exports = {
  obtenerHabilitadoPorId
};

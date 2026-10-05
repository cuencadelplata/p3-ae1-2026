const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
} else {
  console.warn(
    "[Supabase] Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY: el módulo operará sin base de datos persistente (solo Redis/fallback en memoria)."
  );
}

/**
 * Devuelve el cliente de Supabase ya inicializado, o null si no hay credenciales
 * configuradas. Los repositorios que dependan de la base de datos deben manejar
 * el caso null y degradar a su propio fallback (nunca deben lanzar en el import).
 */
function getSupabaseClient() {
  return supabase;
}

module.exports = getSupabaseClient;
module.exports.getSupabaseClient = getSupabaseClient;

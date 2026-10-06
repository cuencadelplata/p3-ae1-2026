import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Faltan SUPABASE_URL o SUPABASE_KEY en las variables de entorno");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

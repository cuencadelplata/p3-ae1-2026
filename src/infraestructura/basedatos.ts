import { Pool } from "pg";
import { config } from "../config";

const requiereSSL =
  config.databaseUrl.includes("supabase.com") ||
  config.databaseUrl.includes("render.com") ||
  config.databaseUrl.includes("sslmode=require");

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: requiereSSL ? { rejectUnauthorized: false } : undefined,
  max: 5,
  connectionTimeoutMillis: 3000,
});

pool.on("error", (err) => {
  console.error("[postgres] Error en cliente inactivo del pool:", err.message);
});

export async function inicializarBaseDatos(): Promise<void> {
  let cliente;
  try {
    cliente = await pool.connect();

    // Tabla para RF-7.7
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS financial_operations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('payment', 'refund', 'transfer', 'payout')),
        amount NUMERIC NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
        created_at TIMESTAMPTZ NOT NULL
      );
    `);

    // Tabla para RF-7.6
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS reintegros (
        id_orden TEXT PRIMARY KEY,
        viaje_id TEXT NOT NULL,
        monto_cancelacion NUMERIC NOT NULL,
        monto_reintegro NUMERIC NOT NULL,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    console.log("[postgres] Tablas de base de datos verificadas/creadas con éxito.");
  } catch (error) {
    console.warn(
      "[postgres] No se pudo conectar a PostgreSQL al arrancar. Modo degradado activo:",
      (error as Error).message
    );
  } finally {
    if (cliente) cliente.release();
  }
}
import { Pool } from "pg";
import { config } from "../config";

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseUrl.includes("render.com") || config.databaseUrl.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : undefined,
  max: 5,
  connectionTimeoutMillis: 3000,
});

pool.on("error", (err) => {
  console.error("[postgres] Error en cliente inactivo del pool:", err.message);
});

export async function inicializarBaseDatos(): Promise<void> {
  try {
    const cliente = await pool.connect();
    try {
      // Tabla para RF-7.7 (Historial financiero)
      await cliente.query(`
        CREATE TABLE IF NOT EXISTS financial_operations (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK (type IN ('payment', 'refund', 'transfer', 'payout')),
          amount NUMERIC NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
          created_at TIMESTAMPTZ NOT NULL
        );
      `);

      // Tabla para RF-7.6 (Reintegros e idempotencia persistente)
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
    } finally {
      cliente.release();
    }
  } catch (error) {
    console.warn("[postgres] No se pudo conectar a PostgreSQL al arrancar. Modo degradado / memoria activo:", (error as Error).message);
  }
}

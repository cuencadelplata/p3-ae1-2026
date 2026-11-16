import { pool } from "../../infraestructura/basedatos";

export interface NuevoReintegro {
  idOrden: string;
  viajeId: string;
  montoCancelacion: number;
  montoReintegro: number;
}

export async function insertarReintegro(r: NuevoReintegro): Promise<boolean> {
  const sql = `
    INSERT INTO reintegros (id_orden, viaje_id, monto_cancelacion, monto_reintegro)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id_orden) DO NOTHING
  `;
  const result = await pool.query(sql, [r.idOrden, r.viajeId, r.montoCancelacion, r.montoReintegro]);
  return (result.rowCount ?? 0) > 0;
}

export async function existeOrden(idOrden: string): Promise<boolean> {
  const sql = `SELECT id_orden FROM reintegros WHERE id_orden = $1`;
  const result = await pool.query(sql, [idOrden]);
  return (result.rowCount ?? 0) > 0;
}

export async function existeViaje(viajeId: string): Promise<boolean> {
  const sql = `SELECT viaje_id FROM reintegros WHERE viaje_id = $1`;
  const result = await pool.query(sql, [viajeId]);
  return (result.rowCount ?? 0) > 0;
}

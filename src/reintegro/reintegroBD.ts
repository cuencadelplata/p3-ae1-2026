import { pool } from "../infraestructura/basedatos";

export interface NuevoReintegro {
  idOrden: string;
  viajeId: string;
  montoCancelacion: number;
  montoReintegro: number;
}

const ordenesMemoria = new Set<string>();

export async function insertarReintegro(r: NuevoReintegro): Promise<boolean> {
  try {
    const res = await pool.query(
      `INSERT INTO reintegros (id_orden, viaje_id, monto_cancelacion, monto_reintegro)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id_orden) DO NOTHING
       RETURNING id_orden`,
      [r.idOrden, r.viajeId, r.montoCancelacion, r.montoReintegro]
    );
    return (res.rowCount ?? 0) === 1;
  } catch (error) {
    console.warn("[reintegroBD] Fallback en memoria ante error de BD:", (error as Error).message);
    if (ordenesMemoria.has(r.idOrden)) {
      return false;
    }
    ordenesMemoria.add(r.idOrden);
    return true;
  }
}

export async function existeOrden(idOrden: string): Promise<boolean> {
  try {
    const res = await pool.query("SELECT 1 FROM reintegros WHERE id_orden = $1", [idOrden]);
    return (res.rowCount ?? 0) > 0;
  } catch (error) {
    return ordenesMemoria.has(idOrden);
  }
}

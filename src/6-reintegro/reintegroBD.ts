import { pool } from "../infraestructura/basedatos";

export interface NuevoReintegro {
  idOrden: string;
  viajeId: string;
  montoCancelacion: number;
  montoReintegro: number;
}

// true si insertó, false si la orden ya existía (idempotencia garantizada por el UNIQUE)
export async function insertarReintegro(r: NuevoReintegro): Promise<boolean> {
  const res = await pool.query(
    `insert into reintegros (id_orden, viaje_id, monto_cancelacion, monto_reintegro)
     values ($1, $2, $3, $4)
     on conflict (id_orden) do nothing
     returning id`,
    [r.idOrden, r.viajeId, r.montoCancelacion, r.montoReintegro]
  );
  return (res.rowCount ?? 0) === 1;
}

export async function existeOrden(idOrden: string): Promise<boolean> {
  const res = await pool.query("select 1 from reintegros where id_orden = $1", [idOrden]);
  return (res.rowCount ?? 0) > 0;
}
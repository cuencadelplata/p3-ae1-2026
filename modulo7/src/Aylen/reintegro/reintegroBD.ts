import { supabase } from "../../supabaseClient";

export interface NuevoReintegro {
  idOrden: string;
  viajeId: string;
  montoCancelacion: number;
  montoReintegro: number;
}

export async function insertarReintegro(r: NuevoReintegro): Promise<boolean> {
  const { error, count } = await supabase
    .from("reintegros")
    .upsert(
      {
        id_orden: r.idOrden,
        viaje_id: r.viajeId,
        monto_cancelacion: r.montoCancelacion,
        monto_reintegro: r.montoReintegro,
      },
      { onConflict: "id_orden", ignoreDuplicates: true }
    )
    .select();

  if (error) throw new Error(`insertarReintegro: ${error.message}`);
  return (count ?? 1) > 0;
}

export async function existeOrden(idOrden: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("reintegros")
    .select("id_orden")
    .eq("id_orden", idOrden)
    .maybeSingle();

  if (error) throw new Error(`existeOrden: ${error.message}`);
  return data !== null;
}

export async function existeViaje(viajeId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("reintegros")
    .select("viaje_id")
    .eq("viaje_id", viajeId)
    .maybeSingle();

  if (error) throw new Error(`existeViaje: ${error.message}`);
  return data !== null;
}
import { supabase } from "../../supabaseClient";

export interface NuevoReintegro {
  idOrden: string;
  viajeId: string;
  montoCancelacion: number;
  montoReintegro: number;
}

const ordenesMemoria = new Set<string>();

export async function insertarReintegro(r: NuevoReintegro): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("reintegros")
      .insert({
        id_orden: r.idOrden,
        viaje_id: r.viajeId,
        monto_cancelacion: r.montoCancelacion,
        monto_reintegro: r.montoReintegro,
      });
    if (error) {
      if (error.code === "23505") return false; // duplicate
      throw error;
    }
    return true;
  } catch (error) {
    console.warn("[reintegroBD] Fallback en memoria ante error de BD:", (error as Error).message);
    if (ordenesMemoria.has(r.idOrden)) return false;
    ordenesMemoria.add(r.idOrden);
    return true;
  }
}

export async function existeOrden(idOrden: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("reintegros")
      .select("id_orden")
      .eq("id_orden", idOrden)
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  } catch {
    return ordenesMemoria.has(idOrden);
  }
}

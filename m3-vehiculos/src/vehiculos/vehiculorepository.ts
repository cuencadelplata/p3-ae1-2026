import { type VehiculoParaInsertar } from "./vehiculo.js";

// Fila tal como la espera la tabla 'vehiculos' de Supabase (columnas snake_case)
export interface VehiculoRow {
  driver_id: string;
  patente: string;
  marca: string | null;
  modelo: string | null;
  anio: number;
  tipo_servicio: string;
  activo: boolean;
}

// Único lugar del código que sabe que las columnas son snake_case
export function toVehiculoRow(v: VehiculoParaInsertar): VehiculoRow {
  return {
    driver_id: v.driverId,
    patente: v.patente,
    marca: v.marca,
    modelo: v.modelo,
    anio: v.anio,
    tipo_servicio: v.tipoServicio,
    activo: v.activo,
  };
}

// Ejemplo de uso en el endpoint (Supabase genera el id uuid solo):
//
// const datosPreparados = prepararVehiculoParaInsertar(req.body);
// const fila = toVehiculoRow(datosPreparados);
// const { data, error } = await supabase
//   .from("vehiculos")
//   .insert(fila)
//   .select()
//   .single();
import { supabase } from "../config/supabaseClient.js";
import {
  TipoServicio,
  type Vehiculo,
  type VehiculoParaInsertar,
} from "./vehiculo.js";

// Fila cruda tal como la devuelve Supabase (snake_case)
interface VehiculoFila {
  id: string;
  driver_id: string;
  patente: string;
  marca: string | null;
  modelo: string | null;
  anio: number;
  tipo_servicio: string;
  activo: boolean;
  created_at: string;
}

function filaAVehiculo(fila: VehiculoFila): Vehiculo {
  return {
    id: fila.id,
    driverId: fila.driver_id,
    patente: fila.patente,
    marca: fila.marca,
    modelo: fila.modelo,
    anio: fila.anio,
    tipoServicio: fila.tipo_servicio as TipoServicio,
    activo: fila.activo,
    createdAt: new Date(fila.created_at),
  };
}

export async function existePatente(patente: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("vehiculos")
    .select("id")
    .eq("patente", patente)
    .maybeSingle();

  if (error) {
    throw new Error(`Error consultando patente: ${error.message}`);
  }
  return data !== null;
}

export async function insertarVehiculo(
  datos: VehiculoParaInsertar,
): Promise<Vehiculo> {
  const { data, error } = await supabase
    .from("vehiculos")
    .insert({
      driver_id: datos.driverId,
      patente: datos.patente,
      marca: datos.marca,
      modelo: datos.modelo,
      anio: datos.anio,
      tipo_servicio: datos.tipoServicio,
      activo: datos.activo,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Error al registrar vehículo: ${error.message}`);
  }
  return filaAVehiculo(data as VehiculoFila);
}

export async function listarVehiculosPorConductor(
  driverId: string,
): Promise<Vehiculo[]> {
  const { data, error } = await supabase
    .from("vehiculos")
    .select("*")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Error al listar vehículos: ${error.message}`);
  }
  return (data as VehiculoFila[]).map(filaAVehiculo);
}

export async function buscarVehiculoDeConductor(
  driverId: string,
  vehicleId: string,
): Promise<Vehiculo | null> {
  const { data, error } = await supabase
    .from("vehiculos")
    .select("*")
    .eq("id", vehicleId)
    .eq("driver_id", driverId)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al buscar vehículo: ${error.message}`);
  }
  return data ? filaAVehiculo(data as VehiculoFila) : null;
}

export async function activarVehiculoEnBD(
  driverId: string,
  vehicleId: string,
): Promise<Vehiculo> {
  // Desactiva cualquier otro vehículo activo del conductor
  const { error: errorDesactivar } = await supabase
    .from("vehiculos")
    .update({ activo: false })
    .eq("driver_id", driverId)
    .neq("id", vehicleId)
    .eq("activo", true);

  if (errorDesactivar) {
    throw new Error(
      `Error al desactivar otros vehículos: ${errorDesactivar.message}`,
    );
  }

  const { data, error } = await supabase
    .from("vehiculos")
    .update({ activo: true })
    .eq("id", vehicleId)
    .eq("driver_id", driverId)
    .select()
    .single();

  if (error) {
    throw new Error(`Error al activar vehículo: ${error.message}`);
  }
  return filaAVehiculo(data as VehiculoFila);
}
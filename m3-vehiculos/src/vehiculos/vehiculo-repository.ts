import { randomUUID } from "node:crypto";
import { AppError } from "../errors/AppError.js";
import { type VehiculoParaInsertar } from "./vehiculo-dto.js";
import { type Vehiculo } from "./vehiculo-model.js";

/** Persistencia en memoria (sin Supabase / DB externa). */
const vehiculos = new Map<string, Vehiculo>();

export async function existePatente(patente: string): Promise<boolean> {
  for (const v of vehiculos.values()) {
    if (v.patente === patente) return true;
  }
  return false;
}

export async function insertarVehiculo(
  datos: VehiculoParaInsertar,
): Promise<Vehiculo> {
  if (await existePatente(datos.patente)) {
    throw new AppError("Ya existe un vehículo con esa patente", 409);
  }

  const vehiculo: Vehiculo = {
    id: randomUUID(),
    driverId: datos.driverId,
    patente: datos.patente,
    marca: datos.marca,
    modelo: datos.modelo,
    anio: datos.anio,
    tipoServicio: datos.tipoServicio,
    activo: datos.activo,
    createdAt: new Date(),
  };

  vehiculos.set(vehiculo.id, vehiculo);
  return { ...vehiculo };
}

export async function listarVehiculosPorConductor(
  driverId: string,
): Promise<Vehiculo[]> {
  return Array.from(vehiculos.values())
    .filter((v) => v.driverId === driverId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((v) => ({ ...v }));
}

export async function buscarVehiculoDeConductor(
  driverId: string,
  vehicleId: string,
): Promise<Vehiculo | null> {
  const vehiculo = vehiculos.get(vehicleId);
  if (!vehiculo || vehiculo.driverId !== driverId) return null;
  return { ...vehiculo };
}

export async function activarVehiculoEnBD(
  driverId: string,
  vehicleId: string,
): Promise<Vehiculo> {
  const actual = vehiculos.get(vehicleId);
  if (!actual || actual.driverId !== driverId) {
    throw new AppError("Vehículo no encontrado", 404);
  }

  for (const [id, v] of vehiculos) {
    if (v.driverId === driverId && v.activo && id !== vehicleId) {
      vehiculos.set(id, { ...v, activo: false });
    }
  }

  const activado: Vehiculo = { ...actual, activo: true };
  vehiculos.set(vehicleId, activado);
  return { ...activado };
}

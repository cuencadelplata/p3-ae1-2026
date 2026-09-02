import { TipoServicio, type Vehiculo } from "./vehiculo-model.js";
import type {
  VehiculoRequestDTO,
  VehiculoParaInsertar,
} from "./vehiculo-dto.js";
import {
  insertarVehiculo,
  listarVehiculosPorConductor,
  buscarVehiculoDeConductor,
  activarVehiculoEnBD,
} from "./vehiculo-repository.js";
import { AppError } from "../errors/AppError.js";

const PATENTE_REGEX = /^([A-Z]{3}[0-9]{3}|[A-Z]{2}[0-9]{3}[A-Z]{2})$/;

export async function registrarVehiculo(
  driverId: string,
  datos: VehiculoRequestDTO,
): Promise<Vehiculo> {
  if (!datos.patente) throw new AppError("Falta la patente");

  const patente = datos.patente.trim().toUpperCase();
  if (!PATENTE_REGEX.test(patente)) {
    throw new AppError("Patente inválida, formato AAA000 o AA000AA");
  }

  const tipo = String(datos.tipoServicio).toUpperCase();
  if (tipo !== "AUTO" && tipo !== "MOTO") {
    throw new AppError("El tipo de servicio tiene que ser AUTO o MOTO");
  }

  const anioActual = new Date().getFullYear();
  if (!datos.anio || datos.anio < 1990 || datos.anio > anioActual + 1) {
    throw new AppError("Año inválido");
  }

  const payload: VehiculoParaInsertar = {
    driverId,
    patente,
    marca: datos.marca?.trim() || null,
    modelo: datos.modelo?.trim() || null,
    anio: datos.anio,
    tipoServicio: tipo as TipoServicio,
    activo: false,
  };

  return insertarVehiculo(payload); // si la patente ya existe, errorrrr 409 directo
}

export async function listarVehiculos(driverId: string) {
  return listarVehiculosPorConductor(driverId);
}

export async function obtenerVehiculo(driverId: string, vehicleId: string) {
  const vehiculo = await buscarVehiculoDeConductor(driverId, vehicleId);
  if (!vehiculo) throw new AppError("Vehículo no encontrado", 404);
  return vehiculo;
}

export async function activarVehiculo(driverId: string, vehicleId: string) {
  const vehiculo = await buscarVehiculoDeConductor(driverId, vehicleId);
  if (!vehiculo) throw new AppError("Vehículo no encontrado", 404);
  return activarVehiculoEnBD(driverId, vehicleId);
}

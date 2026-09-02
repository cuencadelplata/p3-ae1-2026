import { TipoServicio, type Vehiculo } from "./vehiculo-model.js";
import {
  type VehiculoRequestDTO,
  type VehiculoParaInsertar,
} from "./vehiculo-dto.js";
import {
  existePatente,
  insertarVehiculo,
  listarVehiculosPorConductor,
  buscarVehiculoDeConductor,
  activarVehiculoEnBD,
} from "./vehiculo-repository.js";
import { ValidationError } from "../errors/validationError.js";
//import { NotFoundError } from "../errors/notFoundError.js";

const PATENTE_REGEX = /^([A-Z]{3}[0-9]{3}|[A-Z]{2}[0-9]{3}[A-Z]{2})$/;

export function validarYPrepararVehiculo(
  driverId: string,
  datos: VehiculoRequestDTO,
): VehiculoParaInsertar {
  if (!driverId || typeof driverId !== "string" || driverId.trim() === "") {
    throw new ValidationError(
      "El driverId es obligatorio y debe ser un texto.",
    );
  }

  if (
    !datos.patente ||
    typeof datos.patente !== "string" ||
    datos.patente.trim() === ""
  ) {
    throw new ValidationError("La patente es obligatoria.");
  }

  const patenteNormalizada = datos.patente.trim().toUpperCase();
  if (!PATENTE_REGEX.test(patenteNormalizada)) {
    throw new ValidationError(
      "La patente no respeta un formato válido (AAA000 o AA000AA).",
    );
  }

  const tiposValidos = Object.values(TipoServicio) as string[];
  const tipoUpper =
    typeof datos.tipoServicio === "string"
      ? datos.tipoServicio.toUpperCase()
      : "";

  if (!tipoUpper || !tiposValidos.includes(tipoUpper)) {
    throw new ValidationError(
      "El tipo de servicio debe ser estrictamente AUTO o MOTO.",
    );
  }

  const anioActual = new Date().getFullYear();
  if (
    !datos.anio ||
    typeof datos.anio !== "number" ||
    datos.anio < 1990 ||
    datos.anio > anioActual + 1
  ) {
    throw new ValidationError("El año del vehículo no es válido.");
  }

  return {
    driverId: driverId.trim(),
    patente: patenteNormalizada,
    marca: datos.marca?.trim() || null,
    modelo: datos.modelo?.trim() || null,
    anio: datos.anio,
    tipoServicio: tipoUpper as TipoServicio,
    activo: false,
  };
}

export async function registrarVehiculo(
  driverId: string,
  datos: VehiculoRequestDTO,
): Promise<Vehiculo> {
  const payload = validarYPrepararVehiculo(driverId, datos);

  const yaExiste = await existePatente(payload.patente);
  if (yaExiste) {
    throw new ConflictError(
      `Ya existe un vehículo registrado con la patente '${payload.patente}'.`,
    );
  }

  return insertarVehiculo(payload);
}

export async function listarVehiculos(driverId: string): Promise<Vehiculo[]> {
  if (!driverId || driverId.trim() === "") {
    throw new ValidationError("El driverId es obligatorio.");
  }
  return listarVehiculosPorConductor(driverId);
}

export async function obtenerVehiculo(
  driverId: string,
  vehicleId: string,
): Promise<Vehiculo> {
  if (!driverId || !vehicleId) {
    throw new ValidationError("driverId y vehicleId son requeridos.");
  }
  const vehiculo = await buscarVehiculoDeConductor(driverId, vehicleId);
  if (!vehiculo) {
    throw new NotFoundError(
      `No se encontró el vehículo ${vehicleId} para el conductor ${driverId}.`,
    );
  }
  return vehiculo;
}

export async function activarVehiculo(
  driverId: string,
  vehicleId: string,
): Promise<Vehiculo> {
  if (!driverId || !vehicleId) {
    throw new ValidationError("driverId y vehicleId son requeridos.");
  }
  const vehiculo = await buscarVehiculoDeConductor(driverId, vehicleId);
  if (!vehiculo) {
    throw new NotFoundError(
      `No se encontró el vehículo ${vehicleId} para el conductor ${driverId}.`,
    );
  }
  return activarVehiculoEnBD(driverId, vehicleId);
}

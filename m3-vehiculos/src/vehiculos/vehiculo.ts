export enum TipoServicio {
  AUTO = "AUTO",
  MOTO = "MOTO",
}

const PATENTE_REGEX = /^([A-Z]{3}[0-9]{3}|[A-Z]{2}[0-9]{3}[A-Z]{2})$/;

export interface VehiculoDatos {
  driverId: string;
  patente: string;
  marca?: string;
  modelo?: string;
  anio: number;
  tipoServicio: TipoServicio | string;
}

export interface Vehiculo {
  id: string;
  driverId: string;
  patente: string;
  marca: string | null;
  modelo: string | null;
  anio: number;
  tipoServicio: TipoServicio;
  activo: boolean;
  createdAt: Date;
}



// validación de reglas de vehículo
export function validarVehiculo(datos: VehiculoDatos): void {
  if (
    !datos.driverId ||
    typeof datos.driverId !== "string" ||
    datos.driverId.trim() === ""
  ) {
    throw new Error("El driverId es obligatorio y debe ser un texto.");
  }

  if (
    !datos.patente ||
    typeof datos.patente !== "string" ||
    datos.patente.trim() === ""
  ) {
    throw new Error("La patente es obligatoria.");
  }

  const tiposValidos = Object.values(TipoServicio) as string[];
  const tipoUpper =
    typeof datos.tipoServicio === "string"
      ? datos.tipoServicio.toUpperCase()
      : "";

  if (!tipoUpper || !tiposValidos.includes(tipoUpper)) {
    throw new Error("El tipo de servicio debe ser estrictamente AUTO o MOTO.");
  }

  const anioActual = new Date().getFullYear();
  if (
    !datos.anio ||
    typeof datos.anio !== "number" ||
    datos.anio < 1990 ||
    datos.anio > anioActual + 1
  ) {
    throw new Error("El año del vehículo no es válido.");
  }
}

// instanciar vehículo
export function crearVehiculo(datos: VehiculoDatos): Vehiculo {
  validarVehiculo(datos);

  return {
    id: `veh-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    driverId: datos.driverId.trim(),
    patente: datos.patente.trim().toUpperCase(),
    marca: datos.marca?.trim() || "",
    modelo: datos.modelo?.trim() || "",
    anio: datos.anio,
    tipoServicio: datos.tipoServicio.toUpperCase() as TipoServicio,
    activo: false,
    createdAt: new Date(),
  };
}

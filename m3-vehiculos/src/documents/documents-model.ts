export enum TipoDocumento {
  LICENCIA_CONDUCIR = "LICENCIA_CONDUCIR",
  SEGURO_VEHICULO = "SEGURO_VEHICULO",
  CEDULA_VEHICULO = "CEDULA_VEHICULO",
}

export enum EstadoDocumento {
  PENDIENTE = "PENDIENTE",
  APROBADO = "APROBADO",
  RECHAZADO = "RECHAZADO",
}

export interface Documento {
  id: string;
  driverId: string;
  vehicleId: string | null;
  tipoDocumento: TipoDocumento;
  numeroDocumento: string;
  fechaVencimiento: Date;
  archivoUrl: string;
  estado: EstadoDocumento;
  createdAt: Date;
}

////////////////////////
/*
enum TipoDocumento {
  LICENCIA_CONDUCIR = "LICENCIA_CONDUCIR",
  SEGURO_VEHICULO = "SEGURO_VEHICULO",
  CEDULA_VEHICULO = "CEDULA_VEHICULO",
}

enum EstadoDocumento {
  PENDIENTE = "PENDIENTE",
  APROBADO = "APROBADO",
  RECHAZADO = "RECHAZADO",
}

export { TipoDocumento, EstadoDocumento };

export interface DocumentoDatos {
  driverId: string;
  vehicleId?: string | null;
  tipoDocumento: TipoDocumento | string;
  numeroDocumento: string;
  fechaVencimiento: string | Date;
  archivoUrl: string;
}

export interface Documento {
  id: string;
  driverId: string;
  vehicleId: string | null;
  tipoDocumento: TipoDocumento;
  numeroDocumento: string;
  fechaVencimiento: Date;
  archivoUrl: string;
  estado: EstadoDocumento;
  createdAt: Date;
}

// validación de reglas de Documentación
export function validarDocumento(datos: DocumentoDatos): void {
  if (
    !datos.driverId ||
    typeof datos.driverId !== "string" ||
    datos.driverId.trim() === ""
  ) {
    throw new Error("El driverId es obligatorio.");
  }

  const tiposValidos = Object.values(TipoDocumento) as string[];
  const tipoUpper =
    typeof datos.tipoDocumento === "string"
      ? datos.tipoDocumento.toUpperCase()
      : "";

  if (!tipoUpper || !tiposValidos.includes(tipoUpper)) {
    throw new Error(
      `Tipo de documento inválido. Opciones permitidas: ${tiposValidos.join(", ")}`,
    );
  }

  if (
    !datos.numeroDocumento ||
    typeof datos.numeroDocumento !== "string" ||
    datos.numeroDocumento.trim() === ""
  ) {
    throw new Error("El número de documento o póliza es obligatorio.");
  }

  if (
    !datos.archivoUrl ||
    typeof datos.archivoUrl !== "string" ||
    datos.archivoUrl.trim() === ""
  ) {
    throw new Error("La URL del archivo es obligatoria.");
  }

  // no se pueden registrar documentos vencidos
  const fechaExp = new Date(datos.fechaVencimiento);
  if (isNaN(fechaExp.getTime()) || fechaExp <= new Date()) {
    throw new Error(
      "La fecha de vencimiento debe ser una fecha válida y posterior al día de hoy.",
    );
  }

  // Seguro y cédula requieren estar asociados a un vehículo
  const requiereVehiculo =
    tipoUpper === TipoDocumento.SEGURO_VEHICULO ||
    tipoUpper === TipoDocumento.CEDULA_VEHICULO;

  if (requiereVehiculo && (!datos.vehicleId || datos.vehicleId.trim() === "")) {
    throw new Error(
      `El documento de tipo ${tipoUpper} debe estar asociado a un vehicleId.`,
    );
  }
}
*/
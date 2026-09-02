import { TipoDocumento, type Documento } from "./documents-model.js";

import type {
  DocumentoRequestDTO,
  DocumentoParaInsertar,
} from "./documents-dto.js";
import {
  insertarDocumento,
  listarDocumentosPorConductor,
  buscarDocumentoDeConductor,
} from "./documents-repository.js";
import { buscarVehiculoDeConductor } from "../vehiculos/vehiculo-repository.js";
import { AppError } from "../errors/AppError.js";

export async function registrarDocumento(
  driverId: string,
  datos: DocumentoRequestDTO,
): Promise<Documento> {
  const tipo = String(datos.tipoDocumento).toUpperCase();
  const tiposValidos = Object.values(TipoDocumento) as string[];
  if (!tiposValidos.includes(tipo)) {
    throw new AppError("Tipo de documento inválido");
  }

  if (!datos.numeroDocumento)
    throw new AppError("Falta el número de documento");
  if (!datos.archivoUrl) throw new AppError("Falta la URL del archivo");

  const fecha = new Date(datos.fechaVencimiento);
  if (isNaN(fecha.getTime()) || fecha <= new Date()) {
    throw new AppError("La fecha de vencimiento tiene que ser futura");
  }

  const requiereVehiculo =
    tipo === "SEGURO_VEHICULO" || tipo === "CEDULA_VEHICULO";

  if (requiereVehiculo && !datos.vehicleId) {
    throw new AppError(`El documento ${tipo} necesita un vehicleId`);
  }
  if (!requiereVehiculo && datos.vehicleId) {
    throw new AppError("La licencia de conducir no va asociada a un vehículo");
  }

  if (datos.vehicleId) {
    const vehiculo = await buscarVehiculoDeConductor(driverId, datos.vehicleId);
    if (!vehiculo) {
      throw new AppError("El vehículo no existe o no es de este conductor");
    }
  }

  const payload: DocumentoParaInsertar = {
    driverId,
    vehicleId: datos.vehicleId || null,
    tipoDocumento: tipo as TipoDocumento,
    numeroDocumento: datos.numeroDocumento.trim(),
    fechaVencimiento: fecha.toISOString().split("T")[0]!,
    archivoUrl: datos.archivoUrl.trim(),
  };

  return insertarDocumento(payload);
}

export async function listarDocumentos(driverId: string) {
  return listarDocumentosPorConductor(driverId);
}

export async function obtenerDocumento(driverId: string, documentId: string) {
  const documento = await buscarDocumentoDeConductor(driverId, documentId);
  if (!documento) throw new AppError("Documento no encontrado", 404);
  return documento;
}

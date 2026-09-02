import { TipoDocumento, type Documento } from "./documents-model.js";

// Lo que manda el cliente (sin driverId: viene de la URL)
export interface DocumentoRequestDTO {
  tipoDocumento: TipoDocumento | string;
  vehicleId?: string;
  numeroDocumento: string;
  fechaVencimiento: string; // "2027-03-15"
  archivoUrl: string;
}

// Payload interno ya validado, listo para insertar (sin id/createdAt/estado)
export interface DocumentoParaInsertar {
  driverId: string;
  vehicleId: string | null;
  tipoDocumento: TipoDocumento;
  numeroDocumento: string;
  fechaVencimiento: string;
  archivoUrl: string;
}

export interface DocumentoResponseDTO {
  id: string;
  driverId: string;
  vehicleId: string | null;
  tipoDocumento: TipoDocumento;
  numeroDocumento: string;
  fechaVencimiento: string;
  archivoUrl: string;
  estado: string;
  createdAt: string;
}

export function toDocumentoResponseDTO(
  documento: Documento,
): DocumentoResponseDTO {
  return {
    id: documento.id,
    driverId: documento.driverId,
    vehicleId: documento.vehicleId,
    tipoDocumento: documento.tipoDocumento,
    numeroDocumento: documento.numeroDocumento,
    fechaVencimiento: documento.fechaVencimiento.toISOString().split("T")[0]!,
    archivoUrl: documento.archivoUrl,
    estado: documento.estado,
    createdAt: documento.createdAt.toISOString(),
  };
}

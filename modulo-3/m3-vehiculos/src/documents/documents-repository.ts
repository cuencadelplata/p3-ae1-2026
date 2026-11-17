import { randomUUID } from "node:crypto";
import { EstadoDocumento, type Documento } from "./documents-model.js";
import { type DocumentoParaInsertar } from "./documents-dto.js";

/** Persistencia en memoria (sin Supabase / DB externa). */
const documentos = new Map<string, Documento>();

export async function insertarDocumento(
  datos: DocumentoParaInsertar,
): Promise<Documento> {
  const documento: Documento = {
    id: randomUUID(),
    driverId: datos.driverId,
    vehicleId: datos.vehicleId,
    tipoDocumento: datos.tipoDocumento,
    numeroDocumento: datos.numeroDocumento,
    fechaVencimiento: new Date(datos.fechaVencimiento),
    archivoUrl: datos.archivoUrl,
    estado: EstadoDocumento.PENDIENTE,
    createdAt: new Date(),
  };

  documentos.set(documento.id, documento);
  return { ...documento };
}

export async function listarDocumentosPorConductor(
  driverId: string,
): Promise<Documento[]> {
  return Array.from(documentos.values())
    .filter((d) => d.driverId === driverId)
    .sort(
      (a, b) => a.fechaVencimiento.getTime() - b.fechaVencimiento.getTime(),
    )
    .map((d) => ({ ...d }));
}

export async function buscarDocumentoDeConductor(
  driverId: string,
  documentId: string,
): Promise<Documento | null> {
  const documento = documentos.get(documentId);
  if (!documento || documento.driverId !== driverId) return null;
  return { ...documento };
}

export async function actualizarEstadoDocumento(
  documentId: string,
  estado: "APROBADO" | "RECHAZADO",
): Promise<void> {
  const documento = documentos.get(documentId);
  if (!documento || documento.estado !== EstadoDocumento.PENDIENTE) {
    return;
  }
  documentos.set(documentId, {
    ...documento,
    estado: estado as EstadoDocumento,
  });
}

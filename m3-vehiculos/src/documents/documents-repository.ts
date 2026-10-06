import { supabase } from "../config/supabaseClient.js";
import {
  type Documento,
  type TipoDocumento,
  type EstadoDocumento,
} from "./documents-model.js";
import { type DocumentoParaInsertar } from "./documents-dto.js";

interface DocumentoFila {
  id: string;
  driver_id: string;
  vehicle_id: string | null;
  tipo_documento: string;
  numero_documento: string;
  fecha_vencimiento: string;
  archivo_url: string;
  estado: string;
  created_at: string;
}

function filaADocumento(fila: DocumentoFila): Documento {
  return {
    id: fila.id,
    driverId: fila.driver_id,
    vehicleId: fila.vehicle_id,
    tipoDocumento: fila.tipo_documento as TipoDocumento,
    numeroDocumento: fila.numero_documento,
    fechaVencimiento: new Date(fila.fecha_vencimiento),
    archivoUrl: fila.archivo_url,
    estado: fila.estado as EstadoDocumento,
    createdAt: new Date(fila.created_at),
  };
}

export async function insertarDocumento(
  datos: DocumentoParaInsertar,
): Promise<Documento> {
  const { data, error } = await supabase
    .from("documentos")
    .insert({
      driver_id: datos.driverId,
      vehicle_id: datos.vehicleId,
      tipo_documento: datos.tipoDocumento,
      numero_documento: datos.numeroDocumento,
      fecha_vencimiento: datos.fechaVencimiento,
      archivo_url: datos.archivoUrl,
    })
    .select()
    .single();

  if (error) throw new Error(`Error al registrar documento: ${error.message}`);
  return filaADocumento(data as DocumentoFila);
}

export async function listarDocumentosPorConductor(
  driverId: string,
): Promise<Documento[]> {
  const { data, error } = await supabase
    .from("documentos")
    .select("*")
    .eq("driver_id", driverId)
    .order("fecha_vencimiento", { ascending: true });

  if (error) throw new Error(`Error al listar documentos: ${error.message}`);
  return (data as DocumentoFila[]).map(filaADocumento);
}

export async function buscarDocumentoDeConductor(
  driverId: string,
  documentId: string,
): Promise<Documento | null> {
  const { data, error } = await supabase
    .from("documentos")
    .select("*")
    .eq("id", documentId)
    .eq("driver_id", driverId)
    .maybeSingle();

  if (error) throw new Error(`Error al buscar documento: ${error.message}`);
  return data ? filaADocumento(data as DocumentoFila) : null;
}

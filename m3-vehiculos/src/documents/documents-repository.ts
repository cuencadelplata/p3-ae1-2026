import { supabase } from "../config/supabaseClient.js";
import {
  type Documento,
  type DocumentoDatos,
  EstadoDocumento,
  type TipoDocumento,
  validarDocumento,
} from "./documentos.js";

export class DocumentoRepository {
  //guardar un nuevo documento con validación previa
  static async crear(datos: DocumentoDatos): Promise<Documento> {
    validarDocumento(datos);

    const tipoDoc = (
      typeof datos.tipoDocumento === "string"
        ? datos.tipoDocumento.toUpperCase()
        : datos.tipoDocumento
    ) as TipoDocumento;

    const fechaExp = new Date(datos.fechaVencimiento)
      .toISOString()
      .split("T")[0];

    const { data, error } = await supabase
      .from("driver_documents")
      .insert([
        {
          driver_id: datos.driverId.trim(),
          vehicle_id: datos.vehicleId ? datos.vehicleId.trim() : null,
          doc_type: tipoDoc,
          doc_number: datos.numeroDocumento.trim(),
          expiration_date: fechaExp,
          file_url: datos.archivoUrl.trim(),
          status: EstadoDocumento.PENDIENTE,
        },
      ])
      .select()
      .single();

    if (error) {
      throw new Error(
        `Error al guardar documento en Supabase: ${error.message}`,
      );
    }

    return {
      id: data.id,
      driverId: data.driver_id,
      vehicleId: data.vehicle_id,
      tipoDocumento: data.doc_type as TipoDocumento,
      numeroDocumento: data.doc_number,
      fechaVencimiento: new Date(data.expiration_date),
      archivoUrl: data.file_url,
      estado: data.status as EstadoDocumento,
      createdAt: new Date(data.created_at),
    };
  }

  // Obtener todos los documentos asociados a un conductor
  static async listarPorDriver(driverId: string): Promise<Documento[]> {
    if (!driverId || driverId.trim() === "") {
      throw new Error("El driverId es obligatorio para listar documentos.");
    }

    const { data, error } = await supabase
      .from("driver_documents")
      .select("*")
      .eq("driver_id", driverId.trim());

    if (error) {
      throw new Error(`Error al consultar documentos: ${error.message}`);
    }

    return (data || []).map((fila: any) => ({
      id: fila.id,
      driverId: fila.driver_id,
      vehicleId: fila.vehicle_id,
      tipoDocumento: fila.doc_type as TipoDocumento,
      numeroDocumento: fila.doc_number,
      fechaVencimiento: new Date(fila.expiration_date),
      archivoUrl: fila.file_url,
      estado: fila.status as EstadoDocumento,
      createdAt: new Date(fila.created_at),
    }));
  }

  // Obtener documentos asociados a un vehículo
  static async listarPorVehiculo(vehicleId: string): Promise<Documento[]> {
    if (!vehicleId || vehicleId.trim() === "") {
      throw new Error("El vehicleId es obligatorio.");
    }

    const { data, error } = await supabase
      .from("driver_documents")
      .select("*")
      .eq("vehicle_id", vehicleId.trim());

    if (error) {
      throw new Error(
        `Error al consultar documentos del vehículo: ${error.message}`,
      );
    }

    return (data || []).map((fila: any) => ({
      id: fila.id,
      driverId: fila.driver_id,
      vehicleId: fila.vehicle_id,
      tipoDocumento: fila.doc_type as TipoDocumento,
      numeroDocumento: fila.doc_number,
      fechaVencimiento: new Date(fila.expiration_date),
      archivoUrl: fila.file_url,
      estado: fila.status as EstadoDocumento,
      createdAt: new Date(fila.created_at),
    }));
  }
}

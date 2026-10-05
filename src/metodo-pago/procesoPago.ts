import { supabase } from "../supabaseClient";
import { type MetodoPago, type TipoPago } from "./metodoPago";

function mapRowToMetodoPago(row: any): MetodoPago {
  return {
    pagoId: row.pago_Id,
    clienteId: row.cliente_Id,
    viajeId: row.viaje_Id,
    tipo: row.tipo,
    detalle: row.detalle,
    fecha: row.fecha,
    estado: row.estado,
    paymentId: row.paymentId ?? undefined,
    total: row.total ?? undefined,
    moneda: row.moneda ?? undefined,
  };
}

export async function registrarMetodoPago(
  clienteId: string,
  viajeId: string,
  tipo: TipoPago
): Promise<MetodoPago> {
  if (!clienteId || !viajeId) {
    throw new Error("clienteId y viajeId deben existir");
  }

  const tiposValidos: string[] = ["efectivo", "tarjeta", "transferencia"];
  if (!tiposValidos.includes(tipo)) {
    throw new Error("tipo de pago inválido");
  }

  const { data, error } = await supabase
    .from("pagos")
    .insert({
      cliente_Id: clienteId,
      viaje_Id: viajeId,
      tipo: tipo,
      fecha: new Date().toISOString(),
      detalle: "",
      estado: "pendiente",
    })
    .select()
    .single();

  if (error) {
    throw new Error(`No se pudo registrar el pago: ${error.message}`);
  }

  return mapRowToMetodoPago(data);
}

export async function buscarPagoPorViaje(viajeId: string): Promise<MetodoPago | undefined> {
  const { data, error } = await supabase
    .from("pagos")
    .select()
    .eq("viaje_Id", viajeId)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo buscar el pago: ${error.message}`);
  }

  return data ? mapRowToMetodoPago(data) : undefined;
}

export async function autorizarPago(
  viajeId: string,
  idOrden: string,
  datosPago?: { paymentId?: string; total?: number; moneda?: string }
): Promise<MetodoPago> {
  const metodoPago = await buscarPagoPorViaje(viajeId);

  if (!metodoPago) {
    throw new Error("no existe un tipo de pago registrado que este asociado para dicho viaje");
  }

  if (metodoPago.estado !== "pendiente") {
    throw new Error("El pago no fue procesado aún");
  }

  const { data, error } = await supabase
    .from("pagos")
    .update({
      estado: "autorizado",
      paymentId: datosPago?.paymentId,
      total: datosPago?.total,
      moneda: datosPago?.moneda,
    })
    .eq("viaje_Id", viajeId)
    .select()
    .single();

  if (error) {
    throw new Error(`No se pudo autorizar el pago: ${error.message}`);
  }

  return mapRowToMetodoPago(data);
}

export async function rechazarPago(viajeId: string): Promise<MetodoPago> {
  const metodoPago = await buscarPagoPorViaje(viajeId);

  if (!metodoPago) {
    throw new Error("no existe un tipo de pago registrado que este asociado para dicho viaje");
  }
  if (metodoPago.estado !== "pendiente") {
    throw new Error("El pago no fue procesado aún");
  }

  const { data, error } = await supabase
    .from("pagos")
    .update({ estado: "rechazado" })
    .eq("viaje_Id", viajeId)
    .select()
    .single();

  if (error) {
    throw new Error(`No se pudo rechazar el pago: ${error.message}`);
  }

  return mapRowToMetodoPago(data);
}

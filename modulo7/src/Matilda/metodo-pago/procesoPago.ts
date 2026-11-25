import { randomUUID } from "node:crypto";
import { supabase } from "../../supabaseClient";
import { redis } from "../../infraestructura/redis";
import { type MetodoPago, type TipoPago } from "./metodoPago";

const ordenesProcesadas = new Set<string>();

export class PagoEnProceso extends Error {}

export async function conBloqueoDePago<T>(viajeId: string, ejecutar: () => Promise<T>): Promise<T> {
  const key = `m7:pago:lock:${viajeId}`;
  const owner = randomUUID();
  const acquired = await redis.set(key, owner, { NX: true, PX: 120_000 });
  if (acquired !== "OK") throw new PagoEnProceso();

  try {
    return await ejecutar();
  } finally {
    await redis.eval(
      "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
      { keys: [key], arguments: [owner] },
    ).catch(() => { /* La expiración libera el bloqueo si Redis se desconecta. */ });
  }
}

function generarId(): string {
  return `pago_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

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
      tipo,
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

export async function cambiarTarjetaPendiente(viajeId: string, tipo: "efectivo" | "transferencia"): Promise<MetodoPago> {
  const { data, error } = await supabase
    .from("pagos")
    .update({ tipo, estado: "pendiente" })
    .eq("viaje_Id", viajeId)
    .eq("tipo", "tarjeta")
    .eq("estado", "pendiente")
    .select()
    .single();

  if (error) throw new Error("No se pudo cambiar el medio de pago");
  return mapRowToMetodoPago(data);
}

const PREFIJO_ORDEN = "mp:orden:";

export function ordenRegistrada(pago: MetodoPago): string | undefined {
  return pago.detalle?.startsWith(PREFIJO_ORDEN) ? pago.detalle.slice(PREFIJO_ORDEN.length) : undefined;
}

export async function registrarOrdenTarjeta(pago: MetodoPago, idOrden: string): Promise<void> {
  const { error } = await supabase.from("pagos")
    .update({ detalle: PREFIJO_ORDEN + idOrden })
    .eq("viaje_Id", pago.viajeId)
    .eq("estado", "pendiente");
  if (error) throw new Error("No se pudo guardar la orden de tarjeta");
}

export async function autorizarPago(
  viajeId: string,
  idOrden: string,
  datosPago?: { paymentId?: string; total?: number; moneda?: string },
  pagoVerificado?: MetodoPago,
): Promise<MetodoPago> {
  if (ordenesProcesadas.has(idOrden)) {
    throw new Error("Esta orden de pago ya fue procesada anteriormente");
  }

  const metodoPago = pagoVerificado ?? await buscarPagoPorViaje(viajeId);

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
    .eq("estado", "pendiente")
    .select()
    .single();

  if (error) {
    throw new Error(`No se pudo autorizar el pago: ${error.message}`);
  }

  ordenesProcesadas.add(idOrden);
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

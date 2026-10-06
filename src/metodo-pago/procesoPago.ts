import { MetodoPago, TipoPago } from "./metodoPago";

const metodosPago: MetodoPago[] = [];
// Set para almacenar los ordenes procesadas (idempotencia)
const ordenesProcesadas = new Set<string>();

function generarId(): string {
  return `pago_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

export function registrarMetodoPago(clienteId: string, viajeId: string, tipo: TipoPago): MetodoPago {
  if (!clienteId || !viajeId) {
    throw new Error("clienteId y viajeId deben existir");
  }

  const tiposValidos: string[] = ["efectivo", "tarjeta", "transferencia"];
  if (!tiposValidos.includes(tipo)) {
    throw new Error("tipo de pago inválido");
  }

  const nuevoMetodo: MetodoPago = {
    pagoId: generarId(),
    clienteId,
    viajeId,
    tipo,
    fecha: new Date().toISOString(),
    detalle: "",
    estado: "pendiente",
  };
  metodosPago.push(nuevoMetodo);
  return nuevoMetodo;
}

export function buscarPagoPorViaje(viajeId: string): MetodoPago | undefined {
  return metodosPago.find((metodo) => metodo.viajeId === viajeId);
}

export function autorizarPago(viajeId: string, idOrden: string, paymentId?: string): MetodoPago {
  // 1. Verificación de Idempotencia por idOrden
  if (ordenesProcesadas.has(idOrden)) {
    throw new Error("Esta orden de pago ya fue procesada anteriormente");
  }

  const metodoPago = buscarPagoPorViaje(viajeId);

  if (!metodoPago) {
    throw new Error("no existe un tipo de pago registrado que este asociado para dicho viaje");
  }

  if (metodoPago.estado !== "pendiente") {
    throw new Error("El pago no fue procesado aún");
  }

  // 2. Registrar orden y cambiar estado
  ordenesProcesadas.add(idOrden);
  metodoPago.estado = "autorizado";
  if (paymentId) {
    metodoPago.paymentId = paymentId;
  }

  return metodoPago;
}

export function rechazarPago(viajeId: string): MetodoPago {
  const metodoPago = buscarPagoPorViaje(viajeId);

  if (!metodoPago) {
    throw new Error("no existe un tipo de pago registrado que este asociado para dicho viaje");
  }
  if (metodoPago.estado !== "pendiente") {
    throw new Error("El pago no fue procesado aún");
  }
  metodoPago.estado = "rechazado";

  return metodoPago;
}
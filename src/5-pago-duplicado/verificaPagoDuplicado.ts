import { RegistroPago } from "./IRegistroPago";

// ve si un pago ya fue procesado
// recibe el id y lalista de pagos registrados
export function esPagoDuplicado(idOrden: string, registros: RegistroPago[]): boolean {
  return registros.some(r => r.idOrden === idOrden); // true si algún registro coincide
}
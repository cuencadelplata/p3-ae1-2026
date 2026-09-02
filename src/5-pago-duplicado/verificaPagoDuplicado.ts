// verifica si una orden ya fue procesada antes, buscando su idOrden dentro de la lista de pagos ya registrados

import { RegistroPago } from "./IRegistroPago";
export function esPagoDuplicado(idOrden: string, registros: RegistroPago[]): boolean {
  return registros.some(r => r.idOrden === idOrden);
}
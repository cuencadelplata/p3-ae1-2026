// Calcula cuánto se reintegra del monto que se cobró
// RF-7.6: 95% del monto cobrado como cargo de cancelación (5% comisión)
export function calculoReintegro(montoCancelacion: number): number {
  const PORCENTAJE_REINTEGRO = 0.95;
  return montoCancelacion * PORCENTAJE_REINTEGRO;
}

// Calcula cuanto se reintegra del monto que se cobro

export function calculoReintegro(montoCancelacion: number): number {
  const PORCENTAJE_REINTEGRO = 0.95; // 5% de comisión por cancelación, se devuelve el 95%
  return montoCancelacion * PORCENTAJE_REINTEGRO;
}
/**
 * El identificador de viaje forma parte de las rutas /receipts/:tripId y del
 * contrato con otros modulos, por lo que se restringe a un conjunto seguro de
 * caracteres.
 */
export const TRIP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidTripId(value: unknown): value is string {
  return typeof value === 'string' && TRIP_ID_PATTERN.test(value);
}

/**
 * Numero de comprobante legible para el cliente. No reemplaza al receiptId
 * interno: solo se usa como referencia visible en el PDF y en la descarga.
 */
export function buildReceiptNumber(issuedAt: Date, receiptId: string): string {
  const year = issuedAt.getUTCFullYear();
  const suffix = receiptId.replace(/-/g, '').slice(0, 10).toUpperCase();
  return `CMP-${year}-${suffix}`;
}


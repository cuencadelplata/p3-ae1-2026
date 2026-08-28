/**
 * El identificador de viaje se usa como nombre de archivo en el almacenamiento,
 * por lo que se restringe a un conjunto seguro de caracteres. Esto evita
 * recorridos de directorio ("../") en las rutas /receipts/:tripId.
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

/** Oculta el destino de una entrega para no volcar datos personales en los logs (RNF-23). */
export function maskDestination(destination: string): string {
  const atIndex = destination.indexOf('@');
  if (atIndex > 0) {
    const user = destination.slice(0, atIndex);
    const domain = destination.slice(atIndex);
    return `${user.slice(0, 1)}${'*'.repeat(Math.max(user.length - 1, 1))}${domain}`;
  }
  if (destination.length <= 4) {
    return '*'.repeat(destination.length);
  }
  return `${'*'.repeat(destination.length - 4)}${destination.slice(-4)}`;
}

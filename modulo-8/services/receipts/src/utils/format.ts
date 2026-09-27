import { env } from '../config/env';

export function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(env.locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Si el codigo de moneda no es reconocido se degrada a un formato simple
    // en lugar de romper la generacion del comprobante.
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatDateTime(isoDate: string): string {
  return new Intl.DateTimeFormat(env.locale, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: env.timezone,
  }).format(new Date(isoDate));
}

export function formatDistance(distanceKm: number): string {
  return `${distanceKm.toFixed(2).replace('.', ',')} km`;
}

export function formatDuration(durationMin: number): string {
  const hours = Math.floor(durationMin / 60);
  const minutes = Math.round(durationMin % 60);
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  BILLETERA: 'Billetera virtual',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  APROBADO: 'Aprobado',
  PENDIENTE: 'Pendiente',
  RECHAZADO: 'Rechazado',
};

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  AUTO: 'Auto',
  MOTO: 'Moto',
};

export function labelForPaymentMethod(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

export function labelForPaymentStatus(status: string): string {
  return PAYMENT_STATUS_LABELS[status] ?? status;
}

export function labelForVehicleType(type: string): string {
  return VEHICLE_TYPE_LABELS[type] ?? type;
}

import { env } from '../config/env';
import { DependencyUnavailableError } from '../errors/dependency-unavailable.error';
import type { Fare, PaymentMethod, PaymentStatus } from '../models/receipt';
import { createLogger, errorMessage } from '../observability/logger';

/**
 * Traduccion explicita del contrato de M7 (GET /metodo-pago/{viajeId}, RF-7.2 y
 * RF-7.3) al modelo interno del comprobante. Un valor que no figure aca se trata
 * como una respuesta con formato inesperado.
 */
export const M7_PAYMENT_STATUSES: Readonly<Record<string, PaymentStatus>> = {
  autorizado: 'APROBADO',
  pendiente: 'PENDIENTE',
  rechazado: 'RECHAZADO',
};

export const M7_PAYMENT_METHODS: Readonly<Record<string, PaymentMethod>> = {
  efectivo: 'EFECTIVO',
  tarjeta: 'TARJETA',
  transferencia: 'TRANSFERENCIA',
};

/** Importe cobrado segun M7. M7 lo informa recien al autorizar el pago. */
export interface M7Amount {
  total: number;
  currency: string;
}

/** Pago de un viaje segun M7, ya traducido al modelo interno. */
export interface M7Payment {
  paymentId: string;
  tripId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount?: M7Amount;
}

// M7 completa la moneda con "ARS" cuando no la recibe al autorizar.
const M7_DEFAULT_CURRENCY = 'ARS';
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const FARE_TOLERANCE = 0.01;

export type PaymentNotAuthorizedCode = 'PAYMENT_PENDING' | 'PAYMENT_NOT_FOUND' | 'PAYMENT_REJECTED';

/**
 * M7 no autoriza (todavia) la emision del comprobante.
 *
 * - PAYMENT_PENDING y PAYMENT_NOT_FOUND se pueden reintentar: el pago puede
 *   registrarse o autorizarse despues.
 * - PAYMENT_REJECTED es terminal: ese pago nunca genera comprobante.
 */
export class PaymentNotAuthorizedError extends Error {
  constructor(
    readonly code: PaymentNotAuthorizedCode,
    readonly tripId: string,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentNotAuthorizedError';
  }

  get retryable(): boolean {
    return this.code !== 'PAYMENT_REJECTED';
  }
}

/** Traduce el cuerpo de M7. Devuelve null si no cumple el contrato. */
export function toM7Payment(body: unknown): M7Payment | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const data = body as Record<string, unknown>;
  const { pagoId, viajeId, tipo, estado } = data;
  const method = typeof tipo === 'string' ? M7_PAYMENT_METHODS[tipo] : undefined;
  const status = typeof estado === 'string' ? M7_PAYMENT_STATUSES[estado] : undefined;
  if (typeof pagoId !== 'string' || typeof viajeId !== 'string' || !method || !status) {
    return null;
  }
  const payment: M7Payment = { paymentId: pagoId, tripId: viajeId, method, status };

  const { total, moneda } = data;
  if (total === undefined || total === null) {
    return payment;
  }
  const currency = moneda ?? M7_DEFAULT_CURRENCY;
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) {
    return null;
  }
  if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency)) {
    return null;
  }
  return { ...payment, amount: { total, currency } };
}

/**
 * Aplica a la tarifa el importe cobrado segun M7, que es quien cobro.
 *
 * El total y la moneda salen de M7. El desglose (base, distancia, tiempo,
 * recargos y descuentos) llega en la entrada y M7 no lo informa: se conserva
 * solo si esta en la misma moneda y suma el total de M7. Si no, se descarta y el
 * comprobante muestra unicamente el total, nunca un desglose que no cierra.
 * Sin importe de M7 la tarifa de la entrada queda como esta.
 */
export function applyM7Amount(fare: Fare, amount: M7Amount | undefined): Fare {
  if (!amount) {
    return fare;
  }
  const breakdown = fare.baseFare + fare.distanceAmount + fare.timeAmount + fare.surcharges - fare.discounts;
  const breakdownMatches =
    fare.currency.toUpperCase() === amount.currency && Math.abs(breakdown - amount.total) <= FARE_TOLERANCE;
  if (breakdownMatches) {
    return { ...fare, currency: amount.currency, total: amount.total };
  }
  return {
    currency: amount.currency,
    baseFare: 0,
    distanceAmount: 0,
    timeAmount: 0,
    surcharges: 0,
    discounts: 0,
    total: amount.total,
  };
}

/**
 * Decide si el pago habilita la emision: solo un pago autorizado por M7.
 * payment es null cuando M7 no tiene un pago registrado para el viaje.
 */
export function ensureAuthorized(payment: M7Payment | null, tripId: string): M7Payment {
  if (!payment) {
    throw new PaymentNotAuthorizedError('PAYMENT_NOT_FOUND', tripId, `M7 no tiene un pago registrado para el viaje ${tripId}`);
  }
  if (payment.status === 'RECHAZADO') {
    throw new PaymentNotAuthorizedError('PAYMENT_REJECTED', tripId, `M7 rechazo el pago del viaje ${tripId}`);
  }
  if (payment.status !== 'APROBADO') {
    throw new PaymentNotAuthorizedError('PAYMENT_PENDING', tripId, `El pago del viaje ${tripId} esta pendiente de autorizacion en M7`);
  }
  return payment;
}

export interface PaymentsClientOptions {
  baseUrl: string;
  timeoutMs: number;
}

export interface PaymentsClient {
  /** Consulta el pago del viaje en M7. Devuelve null si M7 no lo tiene registrado. */
  getPayment(tripId: string): Promise<M7Payment | null>;
  /** Verificacion de salud de la API de M7. */
  isReachable(): Promise<boolean>;
}

function unavailable(reason: string, cause?: unknown): DependencyUnavailableError {
  return new DependencyUnavailableError('payments', `La API de pagos de M7 no esta disponible: ${reason}`, 5, { cause });
}

/**
 * Cliente REST de M7 con timeout por llamada. M7 es la fuente de verdad del
 * estado del pago; el cliente no decide si se emite, solo consulta y traduce.
 */
export function createPaymentsClient(options: PaymentsClientOptions): PaymentsClient {
  const log = createLogger('m7-payments');

  return {
    async getPayment(tripId) {
      let response: Response;
      let body: unknown;
      try {
        response = await fetch(`${options.baseUrl}/metodo-pago/${encodeURIComponent(tripId)}`, {
          signal: AbortSignal.timeout(options.timeoutMs),
        });
        body = await response.json().catch(() => null);
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        const reason = timedOut ? `sin respuesta en ${options.timeoutMs} ms` : errorMessage(error);
        log('warn', 'fallo la consulta del pago a M7', { tripId, reason });
        throw unavailable(reason, error);
      }

      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        log('warn', 'M7 respondio un error al consultar el pago', { tripId, status: response.status });
        throw unavailable(`respondio ${response.status}`);
      }

      const payment = toM7Payment(body);
      if (!payment || payment.tripId !== tripId) {
        throw unavailable('respuesta con formato inesperado');
      }
      return payment;
    },

    async isReachable() {
      try {
        const response = await fetch(`${options.baseUrl}/health`, { signal: AbortSignal.timeout(options.timeoutMs) });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}

export const paymentsClient = createPaymentsClient({
  baseUrl: env.m7PaymentsUrl,
  timeoutMs: env.m7TimeoutMs,
});

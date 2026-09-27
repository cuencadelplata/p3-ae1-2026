import {
  DELIVERY_CHANNELS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  VEHICLE_TYPES,
  type DeliveryChannel,
  type ReceiptRequest,
} from '../models/receipt';
import { TRIP_ID_PATTERN } from '../utils/identifiers';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface ResendRequest {
  channel: DeliveryChannel;
  destination?: string;
}

type Payload = Record<string, unknown>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;
const FARE_TOLERANCE = 0.01;

function asPayload(value: unknown): Payload | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Payload) : null;
}

interface TextOptions {
  required?: boolean;
  maxLength?: number;
  pattern?: RegExp;
}

interface NumberOptions {
  required?: boolean;
  min?: number;
  max?: number;
}

/**
 * Acumula los errores de todos los campos en lugar de cortar en el primero,
 * para devolver un unico 422 con el detalle completo.
 */
class PayloadReader {
  readonly errors: string[] = [];

  nested(source: Payload | null, field: string, path: string, required = true): Payload | null {
    if (!source) {
      return null;
    }
    const raw = source[field];
    if (raw === undefined || raw === null) {
      if (required) {
        this.errors.push(`${path} es obligatorio`);
      }
      return null;
    }
    const nested = asPayload(raw);
    if (!nested) {
      this.errors.push(`${path} debe ser un objeto`);
      return null;
    }
    return nested;
  }

  text(source: Payload | null, field: string, path: string, options: TextOptions = {}): string {
    const { required = true, maxLength = 160, pattern } = options;
    const raw = source?.[field];

    if (raw === undefined || raw === null || raw === '') {
      if (required) {
        this.errors.push(`${path} es obligatorio`);
      }
      return '';
    }
    if (typeof raw !== 'string') {
      this.errors.push(`${path} debe ser un texto`);
      return '';
    }

    const value = raw.trim();
    if (value === '') {
      if (required) {
        this.errors.push(`${path} es obligatorio`);
      }
      return '';
    }
    if (value.length > maxLength) {
      this.errors.push(`${path} supera el maximo de ${maxLength} caracteres`);
      return '';
    }
    if (pattern && !pattern.test(value)) {
      this.errors.push(`${path} tiene un formato invalido`);
      return '';
    }
    return value;
  }

  decimal(source: Payload | null, field: string, path: string, options: NumberOptions = {}): number {
    const { required = true, min = 0, max = Number.MAX_SAFE_INTEGER } = options;
    const raw = source?.[field];

    if (raw === undefined || raw === null || raw === '') {
      if (required) {
        this.errors.push(`${path} es obligatorio`);
      }
      return 0;
    }
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value)) {
      this.errors.push(`${path} debe ser un numero`);
      return 0;
    }
    if (value < min || value > max) {
      this.errors.push(`${path} debe estar entre ${min} y ${max}`);
      return 0;
    }
    return roundToCents(value);
  }

  oneOf<T extends string>(
    source: Payload | null,
    field: string,
    path: string,
    allowed: readonly T[],
    fallback: T,
  ): T {
    const raw = source?.[field];
    if (raw === undefined || raw === null || raw === '') {
      this.errors.push(`${path} es obligatorio`);
      return fallback;
    }
    if (typeof raw !== 'string' || !allowed.includes(raw.toUpperCase() as T)) {
      this.errors.push(`${path} debe ser uno de: ${allowed.join(', ')}`);
      return fallback;
    }
    return raw.toUpperCase() as T;
  }

  timestamp(source: Payload | null, field: string, path: string, required = true): string {
    const raw = source?.[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) {
        this.errors.push(`${path} es obligatorio`);
      }
      return '';
    }
    if (typeof raw !== 'string') {
      this.errors.push(`${path} debe ser una fecha ISO 8601`);
      return '';
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      this.errors.push(`${path} debe ser una fecha ISO 8601 valida`);
      return '';
    }
    return parsed.toISOString();
  }
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function optional(value: string): string | undefined {
  return value === '' ? undefined : value;
}

/** Valida el cuerpo de POST /receipts y lo normaliza al contrato interno. */
export function validateReceiptRequest(body: unknown): ValidationResult<ReceiptRequest> {
  const payload = asPayload(body);
  const reader = new PayloadReader();

  if (!payload) {
    return { ok: false, errors: ['El cuerpo de la solicitud debe ser un objeto JSON'] };
  }

  const tripId = reader.text(payload, 'tripId', 'tripId', { maxLength: 64, pattern: TRIP_ID_PATTERN });
  const issuedAt = reader.timestamp(payload, 'issuedAt', 'issuedAt', false);

  const customerPayload = reader.nested(payload, 'customer', 'customer');
  const customer = {
    id: reader.text(customerPayload, 'id', 'customer.id', { maxLength: 64 }),
    fullName: reader.text(customerPayload, 'fullName', 'customer.fullName'),
    email: optional(
      reader.text(customerPayload, 'email', 'customer.email', { required: false, pattern: EMAIL_PATTERN }),
    ),
    documentId: optional(
      reader.text(customerPayload, 'documentId', 'customer.documentId', { required: false, maxLength: 32 }),
    ),
  };

  const driverPayload = reader.nested(payload, 'driver', 'driver');
  const vehiclePayload = reader.nested(driverPayload, 'vehicle', 'driver.vehicle');
  const driver = {
    id: reader.text(driverPayload, 'id', 'driver.id', { maxLength: 64 }),
    fullName: reader.text(driverPayload, 'fullName', 'driver.fullName'),
    vehicle: {
      type: reader.oneOf(vehiclePayload, 'type', 'driver.vehicle.type', VEHICLE_TYPES, 'AUTO'),
      plate: reader.text(vehiclePayload, 'plate', 'driver.vehicle.plate', { maxLength: 16 }),
      model: optional(
        reader.text(vehiclePayload, 'model', 'driver.vehicle.model', { required: false, maxLength: 64 }),
      ),
    },
  };

  const tripPayload = reader.nested(payload, 'trip', 'trip');
  const trip = {
    origin: reader.text(tripPayload, 'origin', 'trip.origin', { maxLength: 240 }),
    destination: reader.text(tripPayload, 'destination', 'trip.destination', { maxLength: 240 }),
    startedAt: reader.timestamp(tripPayload, 'startedAt', 'trip.startedAt'),
    finishedAt: reader.timestamp(tripPayload, 'finishedAt', 'trip.finishedAt'),
    distanceKm: reader.decimal(tripPayload, 'distanceKm', 'trip.distanceKm', { max: 10_000 }),
    durationMin: reader.decimal(tripPayload, 'durationMin', 'trip.durationMin', { max: 10_000 }),
  };

  if (trip.startedAt !== '' && trip.finishedAt !== '' && trip.finishedAt < trip.startedAt) {
    reader.errors.push('trip.finishedAt no puede ser anterior a trip.startedAt');
  }

  const farePayload = reader.nested(payload, 'fare', 'fare');
  const fare = {
    currency: (
      reader.text(farePayload, 'currency', 'fare.currency', {
        required: false,
        maxLength: 3,
        pattern: CURRENCY_PATTERN,
      }) || 'ARS'
    ).toUpperCase(),
    baseFare: reader.decimal(farePayload, 'baseFare', 'fare.baseFare', { required: false }),
    distanceAmount: reader.decimal(farePayload, 'distanceAmount', 'fare.distanceAmount', { required: false }),
    timeAmount: reader.decimal(farePayload, 'timeAmount', 'fare.timeAmount', { required: false }),
    surcharges: reader.decimal(farePayload, 'surcharges', 'fare.surcharges', { required: false }),
    discounts: reader.decimal(farePayload, 'discounts', 'fare.discounts', { required: false }),
    total: reader.decimal(farePayload, 'total', 'fare.total'),
  };

  // El desglose es opcional, pero si viene informado tiene que cerrar con el total.
  const breakdown = roundToCents(
    fare.baseFare + fare.distanceAmount + fare.timeAmount + fare.surcharges - fare.discounts,
  );
  if (breakdown > 0 && Math.abs(breakdown - fare.total) > FARE_TOLERANCE) {
    reader.errors.push(
      `fare.total (${fare.total}) no coincide con el desglose informado (${breakdown})`,
    );
  }

  const paymentPayload = reader.nested(payload, 'payment', 'payment');
  const payment = {
    method: reader.oneOf(paymentPayload, 'method', 'payment.method', PAYMENT_METHODS, 'EFECTIVO'),
    status: reader.oneOf(paymentPayload, 'status', 'payment.status', PAYMENT_STATUSES, 'PENDIENTE'),
    authorizationCode: optional(
      reader.text(paymentPayload, 'authorizationCode', 'payment.authorizationCode', {
        required: false,
        maxLength: 64,
      }),
    ),
  };

  if (reader.errors.length > 0) {
    return { ok: false, errors: reader.errors };
  }

  return {
    ok: true,
    value: { tripId, issuedAt: optional(issuedAt), customer, driver, trip, fare, payment },
  };
}

/** Valida el cuerpo de POST /receipts/:tripId/resend. */
export function validateResendRequest(body: unknown): ValidationResult<ResendRequest> {
  const payload = asPayload(body) ?? {};
  const reader = new PayloadReader();

  const rawChannel = payload['channel'];
  const channel: DeliveryChannel =
    rawChannel === undefined || rawChannel === null || rawChannel === ''
      ? 'EMAIL'
      : reader.oneOf(payload, 'channel', 'channel', DELIVERY_CHANNELS, 'EMAIL');

  const destination = reader.text(payload, 'destination', 'destination', {
    required: false,
    maxLength: 160,
    ...(channel === 'EMAIL' ? { pattern: EMAIL_PATTERN } : {}),
  });

  if (reader.errors.length > 0) {
    return { ok: false, errors: reader.errors };
  }

  return { ok: true, value: { channel, destination: optional(destination) } };
}

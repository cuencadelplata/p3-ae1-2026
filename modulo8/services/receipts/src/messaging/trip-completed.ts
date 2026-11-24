import { env } from '../config/env';
import { isDatabaseUnavailable } from '../db/errors';
import { DependencyUnavailableError } from '../errors/dependency-unavailable.error';
import { createDriversClient, type DriversClient } from '../integrations/m3-drivers';
import { createTripsClient, type CompletedTrip, type TripsClient } from '../integrations/m6-trips';
import { M7_PAYMENT_METHODS, PaymentNotAuthorizedError } from '../integrations/m7-payments';
import type { ReceiptRequest } from '../models/receipt';
import * as inbox from '../repositories/inbox.repository';
import { issueReceipt } from '../services/receipt.service';
import type { ValidationResult } from '../validators/receipt.validator';
import { parseEnvelope, type EventEnvelope } from './envelope';
import { PermanentMessageError } from './errors';

export const TRIP_COMPLETED_EVENT = 'TripCompleted';
export const TRIP_COMPLETED_ROUTING_KEY = 'trip.completed';
const SUPPORTED_VERSION = 1;
const MAX_PLACE_LENGTH = 160;

/** Datos de TripCompleted que usa el comprobante (el resto se consulta a M6, M3 y M7). */
export interface TripCompletedData {
  tripId: string;
  /** userId numerico de M1 del cliente. */
  recipientId: number;
}

export type TripCompletedOutcome =
  | { status: 'duplicate'; messageId: string; tripId: string }
  | { status: 'processed'; messageId: string; tripId: string; receiptId: string; created: boolean };

export interface TripCompletedDependencies {
  trips: TripsClient;
  drivers: DriversClient;
}

/**
 * Valida el TripCompleted que publica M6 en mobility.events (routing key
 * trip.completed) con el sobre comun:
 * { messageId, eventType, version, occurredAt, correlationId, producer,
 *   data: { tripId, recipientId, total, paymentId } }.
 */
export function readTripCompleted(envelope: EventEnvelope): ValidationResult<TripCompletedData> {
  const data = envelope.data;
  const errors: string[] = [];

  if (envelope.eventType !== TRIP_COMPLETED_EVENT) {
    errors.push(`eventType debe ser ${TRIP_COMPLETED_EVENT}`);
  }
  if (envelope.version !== SUPPORTED_VERSION) {
    errors.push(`version ${envelope.version} no soportada; se admite la version ${SUPPORTED_VERSION}`);
  }
  if (typeof data['tripId'] !== 'string' || data['tripId'].trim() === '') {
    errors.push('data.tripId es obligatorio');
  } else if (data['tripId'] !== envelope.correlationId) {
    errors.push('correlationId debe coincidir con data.tripId');
  }
  const recipientId = data['recipientId'];
  if (typeof recipientId !== 'number' || !Number.isSafeInteger(recipientId) || recipientId < 1) {
    errors.push('data.recipientId debe ser el userId numerico de M1');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: { tripId: data['tripId'] as string, recipientId: recipientId as number } };
}

function shorten(place: string): string {
  return place.length <= MAX_PLACE_LENGTH ? place : `${place.slice(0, MAX_PLACE_LENGTH - 3).trimEnd()}...`;
}

/** userId de M1 del conductor: M6 lo guarda como conductorId numerico. */
export function driverUserIdOf(trip: CompletedTrip): number | undefined {
  if (!/^\d+$/.test(trip.driverId)) return undefined;
  const id = Number(trip.driverId);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/**
 * Arma el pedido de emision con datos de los modulos duenos:
 * - M6: recorrido, horarios, distancia, duracion, medio de pago y total.
 * - M3: nombre del conductor y vehiculo.
 * - M1 (via M6): userId del cliente. M1 no comparte nombre ni email.
 * El estado del pago y el importe cobrado los decide M7 dentro de issueReceipt.
 */
export async function buildRequestFromTrip(
  event: TripCompletedData,
  deps: TripCompletedDependencies,
): Promise<ReceiptRequest> {
  const trip = await deps.trips.getCompletedTrip(event.tripId);

  const driverUserId = driverUserIdOf(trip);
  if (driverUserId === undefined) {
    throw new PermanentMessageError('El conductor del viaje no tiene userId de M1', [
      `conductorId ${trip.driverId} no es numerico`,
    ]);
  }
  const method = M7_PAYMENT_METHODS[trip.paymentMethod.toLowerCase()];
  if (!method) {
    throw new PermanentMessageError('Medio de pago de M6 desconocido', [`metodoPago ${trip.paymentMethod}`]);
  }

  const driver = await deps.drivers.getDriver(driverUserId, trip.vehicleType);

  return {
    tripId: trip.tripId,
    customerUserId: event.recipientId,
    driverUserId,
    customer: { id: String(event.recipientId) },
    driver,
    trip: {
      origin: shorten(trip.origin),
      destination: shorten(trip.destination),
      startedAt: trip.startedAt,
      finishedAt: trip.finishedAt,
      distanceKm: Math.round(trip.distanceKm * 100) / 100,
      durationMin: trip.durationMin,
    },
    // M6 informa solo el total: sin desglose, el PDF muestra el total.
    fare: {
      currency: trip.currency,
      baseFare: 0,
      distanceAmount: 0,
      timeAmount: 0,
      surcharges: 0,
      discounts: 0,
      total: Math.round(trip.total * 100) / 100,
    },
    // Provisorio: issueReceipt lo reemplaza por el medio y el estado registrados en M7.
    payment: { method, status: 'PENDIENTE' },
  };
}

let defaultDependencies: TripCompletedDependencies | undefined;

function dependencies(): TripCompletedDependencies {
  defaultDependencies ??= {
    trips: createTripsClient({ baseUrl: env.m6TripsUrl, timeoutMs: env.m6TimeoutMs }),
    drivers: createDriversClient({
      conductorBaseUrl: env.m3ConductorUrl,
      vehiclesBaseUrl: env.m3VehiclesUrl,
      timeoutMs: env.m3TimeoutMs,
    }),
  };
  return defaultDependencies;
}

/**
 * Procesa un mensaje de la cola m8.receipts.trip-completed.
 *
 * Misma idempotencia y clasificacion de errores que payment.confirmed:
 * - messageId ya registrado en la bandeja de entrada: se descarta.
 * - Emision idempotente por tripId (UNIQUE): una reentrega no duplica.
 * - PermanentMessageError (sobre invalido, pago rechazado): DLQ.
 * - DependencyUnavailableError (PostgreSQL, M6, M3 o M7 sin respuesta):
 *   espera sin descontar intentos.
 * - Resto (viaje todavia no visible en M6, datos faltantes en M3, pago
 *   pendiente en M7): transitorio, se reintenta hasta agotar los intentos.
 */
export async function processTripCompleted(
  content: Buffer,
  deps: TripCompletedDependencies = dependencies(),
): Promise<TripCompletedOutcome> {
  try {
    return await processMessage(content, deps);
  } catch (error) {
    if (error instanceof PaymentNotAuthorizedError && !error.retryable) {
      throw new PermanentMessageError('M7 rechazo el pago del viaje', [`${error.code}: ${error.message}`]);
    }
    if (isDatabaseUnavailable(error)) {
      throw new DependencyUnavailableError('postgres', 'PostgreSQL no esta disponible', 5, { cause: error });
    }
    throw error;
  }
}

async function processMessage(content: Buffer, deps: TripCompletedDependencies): Promise<TripCompletedOutcome> {
  const envelope = parseEnvelope(content);
  if (!envelope.ok) {
    throw new PermanentMessageError('Sobre del mensaje invalido', envelope.errors);
  }

  const { messageId, correlationId } = envelope.value;
  if (await inbox.wasProcessed(messageId)) {
    return { status: 'duplicate', messageId, tripId: correlationId };
  }

  const event = readTripCompleted(envelope.value);
  if (!event.ok) {
    throw new PermanentMessageError('Contenido de trip.completed invalido', event.errors);
  }

  const request = await buildRequestFromTrip(event.value, deps);
  const { receipt, created } = await issueReceipt(request);
  await inbox.markProcessed(messageId, envelope.value.eventType, correlationId);

  return { status: 'processed', messageId, tripId: receipt.tripId, receiptId: receipt.receiptId, created };
}

import { randomUUID } from 'crypto';
import type { EventEnvelope } from './envelope';
import { ROUTING_KEY_TO_EVENT_TYPE } from './topology';

/**
 * Normaliza nombres de eventType externos a la convencion PascalCase M8.
 */
const EXTERNAL_EVENT_TYPE_MAP: Record<string, string> = {
  'trip_requested': 'TripRequested',
  'trip.requested': 'TripRequested',
  'trip_assigned': 'TripAssigned',
  'trip.assigned': 'TripAssigned',
  'driver_arrived': 'DriverArrived',
  'trip.driver-arrived': 'DriverArrived',
  'trip_started': 'TripStarted',
  'trip.started': 'TripStarted',
  'trip_cancelled': 'TripCancelled',
  'trip.cancelled': 'TripCancelled',
  'trip_completed': 'TripCompleted',
  'trip.completed': 'TripCompleted',
  'payment_confirmed': 'PaymentConfirmed',
  'payment.confirmed': 'PaymentConfirmed',
  'receipt_issued': 'ReceiptIssued',
  'receipt.issued': 'ReceiptIssued',
  'notification_requested': 'NotificationRequested',
  'notification.requested': 'NotificationRequested',
};

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Adapta un evento crudo externo (procedente de M5, M6 o M7) al envelope canonico de M8.
 * Si el mensaje ya cumple con el envelope M8, lo conserva intacto.
 */
export function adaptExternalEvent(
  content: Buffer | string,
  routingKey?: string
): EventEnvelope {
  const str = typeof content === 'string' ? content : content.toString('utf8');
  let raw: Record<string, unknown> = {};

  try {
    const parsed = JSON.parse(str);
    if (isObject(parsed)) {
      raw = parsed;
    }
  } catch {
    // Si no es JSON valido, fallback con payload encapsulado en data
    raw = { data: { rawContent: str } };
  }

  // 1. Resolver eventType normalizado
  let eventType = typeof raw['eventType'] === 'string' ? raw['eventType'] : '';
  if (!eventType && routingKey && ROUTING_KEY_TO_EVENT_TYPE[routingKey]) {
    eventType = ROUTING_KEY_TO_EVENT_TYPE[routingKey];
  } else if (EXTERNAL_EVENT_TYPE_MAP[eventType.toLowerCase()]) {
    eventType = EXTERNAL_EVENT_TYPE_MAP[eventType.toLowerCase()];
  } else if (!eventType) {
    eventType = 'UnknownEvent';
  }

  // 2. Extraer o normalizar data
  let data: Record<string, unknown> = isObject(raw['data']) ? (raw['data'] as Record<string, unknown>) : { ...raw };

  // Normalizacion de trip_id / tripId
  const tripId = data['tripId'] || data['trip_id'] || raw['tripId'] || raw['trip_id'];
  if (tripId && typeof tripId === 'string' || typeof tripId === 'number') {
    data['tripId'] = String(tripId);
  }

  // 3. Normalizar o generar sobre canonico
  const messageId =
    typeof raw['messageId'] === 'string' && raw['messageId'].trim() !== ''
      ? raw['messageId']
      : randomUUID();

  const version = typeof raw['version'] === 'number' ? raw['version'] : 1;

  const occurredAt =
    typeof raw['occurredAt'] === 'string' && !Number.isNaN(Date.parse(raw['occurredAt']))
      ? raw['occurredAt']
      : new Date().toISOString();

  const correlationId =
    typeof raw['correlationId'] === 'string' && raw['correlationId'].trim() !== ''
      ? raw['correlationId']
      : (data['tripId'] ? String(data['tripId']) : messageId);

  const producer =
    typeof raw['producer'] === 'string' && raw['producer'].trim() !== ''
      ? raw['producer']
      : 'external';

  return {
    messageId,
    eventType,
    version,
    occurredAt,
    correlationId,
    producer,
    data,
  };
}

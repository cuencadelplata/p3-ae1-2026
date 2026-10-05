import type {
  DeliveryEventType,
  NotificationRequestedEnvelope,
  NotificationRequestedData,
} from './delivery.types.js';

const VALID_EVENT_TYPES: Set<DeliveryEventType> = new Set([
  'TRIP_REQUESTED',
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVED',
  'TRIP_STARTED',
  'TRIP_CANCELLED',
  'TRIP_COMPLETED',
]);

const ENVELOPE_PROPERTIES = new Set([
  'messageId',
  'eventType',
  'version',
  'occurredAt',
  'correlationId',
  'producer',
  'data',
]);

const DATA_PROPERTIES = new Set([
  'notificationId',
  'tripId',
  'recipientId',
  'eventType',
  'channel',
  'title',
  'message',
  'targetDestination',
  'priority',
  'createdAt',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertOnlyKnownProperties(
  value: Record<string, unknown>,
  allowedProperties: Set<string>,
  location: string
): void {
  for (const property of Object.keys(value)) {
    if (!allowedProperties.has(property)) {
      throw new ContractValidationError(`${location}.${property} no está definido en el contrato.`);
    }
  }
}

export class ContractValidationError extends Error {
  constructor(message: string) {
    super(`[CONTRACT_VALIDATION_ERROR] ${message}`);
    this.name = 'ContractValidationError';
  }
}

export function validateNotificationRequestedEnvelope(
  raw: unknown
): NotificationRequestedEnvelope {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ContractValidationError('El mensaje debe ser un objeto JSON no nulo.');
  }

  const msg = raw as Record<string, unknown>;

  assertOnlyKnownProperties(msg, ENVELOPE_PROPERTIES, 'envelope');

  if (typeof msg.messageId !== 'string' || !UUID_PATTERN.test(msg.messageId)) {
    throw new ContractValidationError('messageId es obligatorio y debe ser un UUID válido.');
  }

  if (msg.eventType !== 'NotificationRequested') {
    throw new ContractValidationError(
      `eventType inválido: esperado 'NotificationRequested', recibido '${msg.eventType}'.`
    );
  }

  if (msg.version !== 1) {
    throw new ContractValidationError(
      `version de contrato inválida: esperado 1, recibido '${msg.version}'.`
    );
  }

  if (typeof msg.occurredAt !== 'string' || Number.isNaN(Date.parse(msg.occurredAt))) {
    throw new ContractValidationError('occurredAt debe ser una fecha ISO 8601 válida.');
  }

  if (typeof msg.correlationId !== 'string' || msg.correlationId.trim() === '') {
    throw new ContractValidationError('correlationId es obligatorio.');
  }

  if (msg.producer !== 'm8-notifications') {
    throw new ContractValidationError(
      `producer inválido: esperado 'm8-notifications', recibido '${msg.producer}'.`
    );
  }

  if (!msg.data || typeof msg.data !== 'object' || Array.isArray(msg.data)) {
    throw new ContractValidationError('data es obligatorio y debe ser un objeto.');
  }

  const data = msg.data as Record<string, unknown>;

  assertOnlyKnownProperties(data, DATA_PROPERTIES, 'data');

  if (typeof data.notificationId !== 'string' || !UUID_PATTERN.test(data.notificationId)) {
    throw new ContractValidationError('data.notificationId es obligatorio y debe ser un UUID válido.');
  }

  if (typeof data.tripId !== 'string' || data.tripId.trim() === '') {
    throw new ContractValidationError('data.tripId es obligatorio.');
  }

  if (
    typeof data.recipientId !== 'number' ||
    !Number.isInteger(data.recipientId) ||
    data.recipientId < 1
  ) {
    throw new ContractValidationError(
      'data.recipientId es obligatorio y debe ser un número entero positivo (canónico M1).'
    );
  }

  if (!VALID_EVENT_TYPES.has(data.eventType as DeliveryEventType)) {
    throw new ContractValidationError(
      `data.eventType inválido: '${data.eventType}'. Debe ser uno de los eventos de viaje soportados.`
    );
  }

  if (data.channel !== 'PUSH') {
    throw new ContractValidationError(
      `data.channel inválido: '${data.channel}'. Solo se soporta canal 'PUSH' en AE2.`
    );
  }

  if (typeof data.message !== 'string' || data.message.trim() === '') {
    throw new ContractValidationError('data.message es obligatorio y debe ser texto no vacío.');
  }

  if (data.title !== undefined && (typeof data.title !== 'string' || data.title.trim() === '')) {
    throw new ContractValidationError('data.title debe ser texto no vacío cuando se informa.');
  }

  if (data.targetDestination !== undefined && typeof data.targetDestination !== 'string') {
    throw new ContractValidationError('data.targetDestination debe ser texto cuando se informa.');
  }

  if (data.priority !== undefined && data.priority !== 'HIGH' && data.priority !== 'NORMAL') {
    throw new ContractValidationError("data.priority debe ser 'HIGH' o 'NORMAL' cuando se informa.");
  }

  if (typeof data.createdAt !== 'string' || Number.isNaN(Date.parse(data.createdAt))) {
    throw new ContractValidationError('data.createdAt debe ser una fecha ISO 8601 válida.');
  }

  const validatedData: NotificationRequestedData = {
    notificationId: data.notificationId,
    tripId: data.tripId,
    recipientId: data.recipientId,
    eventType: data.eventType as DeliveryEventType,
    channel: 'PUSH',
    title: typeof data.title === 'string' ? data.title : undefined,
    message: data.message,
    targetDestination:
      typeof data.targetDestination === 'string' ? data.targetDestination : undefined,
    priority: data.priority === undefined ? 'NORMAL' : data.priority,
    createdAt: data.createdAt,
  };

  return {
    messageId: msg.messageId,
    eventType: 'NotificationRequested',
    version: 1,
    occurredAt: msg.occurredAt,
    correlationId: msg.correlationId,
    producer: 'm8-notifications',
    data: validatedData,
  };
}

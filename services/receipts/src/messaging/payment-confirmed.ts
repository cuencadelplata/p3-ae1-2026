import { isDatabaseUnavailable } from '../db/errors';
import { DependencyUnavailableError } from '../errors/dependency-unavailable.error';
import { FiscalAuthorizationRejectedError } from '../integrations/fiscal-authorizer';
import { PaymentNotAuthorizedError } from '../integrations/m7-payments';
import type { ReceiptRequest } from '../models/receipt';
import * as inbox from '../repositories/inbox.repository';
import { issueReceipt } from '../services/receipt.service';
import { validateReceiptRequest, type ValidationResult } from '../validators/receipt.validator';
import { parseEnvelope, type EventEnvelope } from './envelope';
import { PermanentMessageError } from './errors';

export const PAYMENT_CONFIRMED_EVENT = 'PaymentConfirmed';
export const PAYMENT_CONFIRMED_ROUTING_KEY = 'payment.confirmed';
const SUPPORTED_VERSION = 1;

export type PaymentConfirmedOutcome =
  | { status: 'duplicate'; messageId: string; tripId: string }
  | { status: 'processed'; messageId: string; tripId: string; receiptId: string; created: boolean };

type Data = Record<string, unknown>;

/**
 * Traduce el evento payment.confirmed al pedido de emision del comprobante.
 *
 * Supone la alternativa 1 del catalogo de eventos v1: M7 incluye en data los
 * datos del cliente, del conductor y del recorrido. Es provisorio: la respuesta de
 * M7 no incluye esos datos y el contenido definitivo se cierra en AE4 (catalogo,
 * seccion 5.1); si cambia, solo se ajusta esta funcion.
 */
export function toReceiptRequest(envelope: EventEnvelope): ValidationResult<ReceiptRequest> {
  const data: Data = envelope.data;
  const errors: string[] = [];

  if (envelope.eventType !== PAYMENT_CONFIRMED_EVENT) {
    errors.push(`eventType debe ser ${PAYMENT_CONFIRMED_EVENT}`);
  }
  if (envelope.version !== SUPPORTED_VERSION) {
    errors.push(`version ${envelope.version} no soportada; se admite la version ${SUPPORTED_VERSION}`);
  }
  if (typeof data['paymentId'] !== 'string' || data['paymentId'].trim() === '') {
    errors.push('data.paymentId es obligatorio');
  }
  if (typeof data['confirmedAt'] !== 'string' || Number.isNaN(Date.parse(data['confirmedAt']))) {
    errors.push('data.confirmedAt debe ser una fecha ISO 8601');
  }
  if (data['status'] !== 'APROBADO') {
    errors.push('data.status debe ser APROBADO en un pago confirmado');
  }
  if (data['tripId'] !== envelope.correlationId) {
    errors.push('correlationId debe coincidir con data.tripId');
  }

  const validation = validateReceiptRequest({
    tripId: data['tripId'],
    customer: data['customer'],
    driver: data['driver'],
    trip: data['trip'],
    fare: data['fare'],
    payment: {
      method: data['method'],
      status: data['status'],
      authorizationCode: data['authorizationCode'],
    },
  });

  if (!validation.ok) {
    errors.push(...validation.errors.map((error) => `data: ${error}`));
  }

  if (errors.length > 0 || !validation.ok) {
    return { ok: false, errors };
  }
  return validation;
}

/**
 * Procesa un mensaje de la cola m8.receipts.payment-confirmed.
 *
 * La idempotencia tiene dos capas:
 * 1. messageId: un mensaje ya registrado en la bandeja de entrada se descarta.
 * 2. tripId: la emision es idempotente por viaje, de modo que si el proceso se
 *    corta despues de emitir y antes de registrar el mensaje, la reentrega
 *    encuentra el comprobante ya emitido y no genera otro.
 *
 * Los errores se clasifican para el consumidor:
 * - PermanentMessageError (sobre o contenido invalido, pago rechazado por M7 o
 *   rechazo del autorizador fiscal): reintentarlo no cambia el resultado, va
 *   directo a la cola de descarte.
 * - DependencyUnavailableError (PostgreSQL caido, M7 sin respuesta, o
 *   autorizador fiscal sin respuesta o con el circuito abierto): el mensaje
 *   espera a que la dependencia se recupere sin descontar intentos.
 * - Cualquier otro, incluido un pago pendiente o sin registrar en M7:
 *   transitorio, se reintenta hasta agotar los intentos.
 */
export async function processPaymentConfirmed(content: Buffer): Promise<PaymentConfirmedOutcome> {
  try {
    return await processMessage(content);
  } catch (error) {
    if (error instanceof PaymentNotAuthorizedError && !error.retryable) {
      throw new PermanentMessageError('M7 rechazo el pago del viaje', [`${error.code}: ${error.message}`]);
    }
    if (error instanceof FiscalAuthorizationRejectedError) {
      throw new PermanentMessageError('El autorizador fiscal rechazo el comprobante', [`${error.code}: ${error.message}`]);
    }
    if (isDatabaseUnavailable(error)) {
      throw new DependencyUnavailableError('postgres', 'PostgreSQL no esta disponible', 5, { cause: error });
    }
    throw error;
  }
}

async function processMessage(content: Buffer): Promise<PaymentConfirmedOutcome> {
  const envelope = parseEnvelope(content);
  if (!envelope.ok) {
    throw new PermanentMessageError('Sobre del mensaje invalido', envelope.errors);
  }

  const { messageId, correlationId } = envelope.value;

  if (await inbox.wasProcessed(messageId)) {
    return { status: 'duplicate', messageId, tripId: correlationId };
  }

  const request = toReceiptRequest(envelope.value);
  if (!request.ok) {
    throw new PermanentMessageError('Contenido de payment.confirmed invalido', request.errors);
  }

  const { receipt, created } = await issueReceipt(request.value);
  await inbox.markProcessed(messageId, envelope.value.eventType, correlationId);

  return { status: 'processed', messageId, tripId: receipt.tripId, receiptId: receipt.receiptId, created };
}

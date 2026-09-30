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
 * datos del cliente, del conductor y del recorrido. El contenido definitivo esta
 * pendiente de confirmacion por M7; si cambia, solo se ajusta esta funcion.
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
 * Un mensaje mal formado lanza PermanentMessageError: reintentarlo no cambia el
 * resultado, por eso va directo a la cola de descarte.
 */
export async function processPaymentConfirmed(content: Buffer): Promise<PaymentConfirmedOutcome> {
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

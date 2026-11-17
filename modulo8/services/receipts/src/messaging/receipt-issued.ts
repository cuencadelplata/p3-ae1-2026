import { randomUUID } from 'node:crypto';

import type { Receipt } from '../models/receipt';
import type { OutboxEvent } from '../repositories/outbox.repository';
import type { EventEnvelope } from './envelope';

export const RECEIPT_ISSUED_EVENT = 'ReceiptIssued';
export const RECEIPT_ISSUED_ROUTING_KEY = 'receipt.issued';
export const RECEIPTS_PRODUCER = 'm8-receipts';
const VERSION = 1;

export interface ReceiptIssuedData {
  tripId: string;
  receiptId: string;
  receiptNumber: string;
  issuedAt: string;
}

/**
 * Arma el evento receipt.issued (catalogo de eventos v1, seccion 5.2).
 *
 * Solo lleva identificadores del comprobante: ni datos del cliente o del
 * conductor ni enlaces de descarga. Quien necesite el documento lo pide por el
 * contrato REST interno.
 */
export function buildReceiptIssuedEvent(receipt: Receipt): OutboxEvent<ReceiptIssuedData> {
  const envelope: EventEnvelope<ReceiptIssuedData> = {
    messageId: randomUUID(),
    eventType: RECEIPT_ISSUED_EVENT,
    version: VERSION,
    occurredAt: receipt.issuedAt,
    correlationId: receipt.tripId,
    producer: RECEIPTS_PRODUCER,
    data: {
      tripId: receipt.tripId,
      receiptId: receipt.receiptId,
      receiptNumber: receipt.receiptNumber,
      issuedAt: receipt.issuedAt,
    },
  };

  return { routingKey: RECEIPT_ISSUED_ROUTING_KEY, envelope };
}

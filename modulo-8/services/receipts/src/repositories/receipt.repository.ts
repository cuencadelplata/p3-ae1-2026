import { randomUUID } from 'node:crypto';

import { pool } from '../db/pool';
import type { DeliveryRecord, Receipt } from '../models/receipt';
import * as outbox from './outbox.repository';

/**
 * Persistencia del comprobante en CommunicationsDB (esquema "receipts").
 *
 * Reemplaza al almacenamiento en sistema de archivos de AE1. El servicio de
 * dominio sigue usando las mismas operaciones de lectura y escritura; lo que
 * cambia es quien garantiza la unicidad: antes el flag de creacion exclusiva
 * del archivo, ahora la restriccion UNIQUE sobre trip_id.
 */

const TRIP_ID_UNIQUE_CONSTRAINT = 'receipts_trip_id_key';
const UNIQUE_VIOLATION = '23505';

export class ReceiptAlreadyExistsError extends Error {
  constructor(tripId: string) {
    super(`Ya existe un comprobante emitido para el viaje ${tripId}`);
    this.name = 'ReceiptAlreadyExistsError';
  }
}

interface ReceiptRow {
  receipt_id: string;
  receipt_number: string;
  trip_id: string;
  issued_at: Date;
  customer: Receipt['customer'];
  driver: Receipt['driver'];
  trip: Receipt['trip'];
  fare: Receipt['fare'];
  payment: Receipt['payment'];
  deliveries: Array<{ channel: DeliveryRecord['channel']; destination: string; sentAt: string }>;
}

function toReceipt(row: ReceiptRow): Receipt {
  return {
    receiptId: row.receipt_id,
    receiptNumber: row.receipt_number,
    tripId: row.trip_id,
    issuedAt: row.issued_at.toISOString(),
    customer: row.customer,
    driver: row.driver,
    trip: row.trip,
    fare: row.fare,
    payment: row.payment,
    deliveries: row.deliveries.map((delivery) => ({
      channel: delivery.channel,
      destination: delivery.destination,
      sentAt: new Date(delivery.sentAt).toISOString(),
    })),
  };
}

function isTripIdConflict(error: unknown): boolean {
  const pgError = error as { code?: string; constraint?: string } | null;
  return pgError?.code === UNIQUE_VIOLATION && pgError.constraint === TRIP_ID_UNIQUE_CONSTRAINT;
}

export async function findByTripId(tripId: string): Promise<Receipt | null> {
  const result = await pool.query<ReceiptRow>(
    `SELECT r.receipt_id, r.receipt_number, r.trip_id, r.issued_at,
            r.customer, r.driver, r.trip, r.fare, r.payment,
            COALESCE(
              (SELECT json_agg(
                        json_build_object('channel', d.channel, 'destination', d.destination, 'sentAt', d.sent_at)
                        ORDER BY d.sent_at, d.delivery_id)
                 FROM receipts.receipt_deliveries d
                WHERE d.receipt_id = r.receipt_id),
              '[]'::json) AS deliveries
       FROM receipts.receipts r
      WHERE r.trip_id = $1`,
    [tripId],
  );

  const row = result.rows[0];
  return row ? toReceipt(row) : null;
}

/**
 * Devuelve el binario del PDF asociado al comprobante del viaje, o null si el
 * comprobante no existe o no tiene documento.
 */
export async function findPdfByTripId(tripId: string): Promise<Buffer | null> {
  const result = await pool.query<{ content: Buffer }>(
    `SELECT d.content
       FROM receipts.receipt_documents d
       JOIN receipts.receipts r ON r.receipt_id = d.receipt_id
      WHERE r.trip_id = $1`,
    [tripId],
  );
  return result.rows[0]?.content ?? null;
}

/**
 * Persiste el comprobante, su PDF y el evento receipt.issued en una sola
 * transaccion: nunca queda un comprobante sin documento ni sin evento, ni un
 * documento o evento huerfano. Si otro proceso ya emitio el comprobante del
 * mismo viaje, la restriccion UNIQUE rechaza la insercion y se informa con
 * ReceiptAlreadyExistsError; como se revierte todo, tampoco queda un segundo
 * evento.
 */
export async function create(receipt: Receipt, pdf: Buffer, issuedEvent: outbox.OutboxEvent): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO receipts.receipts
         (receipt_id, receipt_number, trip_id, issued_at, customer, driver, trip, fare, payment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        receipt.receiptId,
        receipt.receiptNumber,
        receipt.tripId,
        receipt.issuedAt,
        JSON.stringify(receipt.customer),
        JSON.stringify(receipt.driver),
        JSON.stringify(receipt.trip),
        JSON.stringify(receipt.fare),
        JSON.stringify(receipt.payment),
      ],
    );
    await client.query(
      `INSERT INTO receipts.receipt_documents (pdf_key, receipt_id, content_type, size_bytes, content)
       VALUES ($1, $2, 'application/pdf', $3, $4)`,
      [randomUUID(), receipt.receiptId, pdf.length, pdf],
    );
    await outbox.enqueue(client, issuedEvent);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (isTripIdConflict(error)) {
      throw new ReceiptAlreadyExistsError(receipt.tripId);
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Registra un reenvio del comprobante. El historial solo crece por insercion. */
export async function addDelivery(receiptId: string, delivery: DeliveryRecord): Promise<void> {
  await pool.query(
    `INSERT INTO receipts.receipt_deliveries (receipt_id, channel, destination, sent_at)
     VALUES ($1, $2, $3, $4)`,
    [receiptId, delivery.channel, delivery.destination, delivery.sentAt],
  );
}

import { randomUUID } from 'node:crypto';

import { AppError } from '../errors/app-error';
import { buildReceiptIssuedEvent } from '../messaging/receipt-issued';
import type { DeliveryChannel, DeliveryRecord, Receipt, ReceiptRequest } from '../models/receipt';
import * as repository from '../repositories/receipt.repository';
import { buildReceiptNumber, maskDestination } from '../utils/identifiers';
import { createDownloadLink, resolveDownloadLink, type DownloadLink } from './download-link.service';
import { renderReceiptPdf } from './pdf.service';

export interface IssueResult {
  receipt: Receipt;
  created: boolean;
}

/**
 * Emite el comprobante de un viaje finalizado (RF-8.3).
 *
 * La operacion es idempotente por tripId: si el comprobante ya existe se
 * devuelve el mismo documento en lugar de emitir uno nuevo. Ante solicitudes
 * concurrentes, en uno o en varios procesos, la restriccion UNIQUE de la base
 * deja pasar una sola insercion; las demas releen el comprobante ganador.
 *
 * Solo la emision que crea el comprobante registra el evento receipt.issued,
 * sea que llegue por payment.confirmed o por POST: un pedido repetido no
 * genera un segundo evento.
 */
export async function issueReceipt(request: ReceiptRequest): Promise<IssueResult> {
  const existing = await repository.findByTripId(request.tripId);
  if (existing) {
    return { receipt: existing, created: false };
  }

  const receipt = buildReceipt(request);
  const pdf = await renderReceiptPdf(receipt);

  try {
    await repository.create(receipt, pdf, buildReceiptIssuedEvent(receipt));
  } catch (error) {
    if (error instanceof repository.ReceiptAlreadyExistsError) {
      const winner = await repository.findByTripId(request.tripId);
      if (winner) {
        return { receipt: winner, created: false };
      }
    }
    throw error;
  }

  return { receipt, created: true };
}

export async function getReceipt(tripId: string): Promise<Receipt> {
  const receipt = await repository.findByTripId(tripId);
  if (!receipt) {
    throw AppError.notFound('RECEIPT_NOT_FOUND', `No existe un comprobante emitido para el viaje ${tripId}`);
  }
  return receipt;
}

export async function getReceiptPdf(tripId: string): Promise<{ receipt: Receipt; pdf: Buffer }> {
  const receipt = await getReceipt(tripId);
  const pdf = await repository.findPdfByTripId(tripId);

  if (!pdf) {
    throw pdfUnavailable(tripId);
  }

  return { receipt, pdf };
}

function pdfUnavailable(tripId: string): AppError {
  return AppError.conflict(
    'RECEIPT_PDF_UNAVAILABLE',
    `El comprobante del viaje ${tripId} existe pero su archivo PDF no esta disponible`,
  );
}

export interface DeliveryReference extends DownloadLink {
  tripId: string;
  receiptNumber: string;
}

/**
 * Referencia de descarga para Receipts Delivery (RF-8.4): un enlace temporal
 * al PDF, para que el reenvio no necesite acceder a la base de datos del
 * servicio (catalogo de eventos v1, seccion 6).
 */
export async function getDeliveryReference(tripId: string): Promise<DeliveryReference> {
  const receipt = await getReceipt(tripId);
  if (!(await repository.hasPdf(receipt.receiptId))) {
    throw pdfUnavailable(tripId);
  }

  const link = await createDownloadLink(tripId);
  return { tripId, receiptNumber: receipt.receiptNumber, ...link };
}

/** Descarga del PDF a partir de un enlace temporal vigente. */
export async function getReceiptPdfByToken(token: string): Promise<{ receipt: Receipt; pdf: Buffer }> {
  const tripId = await resolveDownloadLink(token);
  return getReceiptPdf(tripId);
}

/**
 * Registra un nuevo envio del comprobante ya emitido (RF-8.4).
 *
 * En AE1 el envio se simula: se deja constancia de la entrega y se devuelve el
 * enlace de descarga. En AE2 este punto pasa a publicar un evento en RabbitMQ
 * hacia el canal de notificaciones correspondiente.
 */
export async function resendReceipt(
  tripId: string,
  channel: DeliveryChannel,
  destination?: string,
): Promise<{ receipt: Receipt; delivery: DeliveryRecord }> {
  const receipt = await getReceipt(tripId);
  const target = destination ?? receipt.customer.email;

  if (!target) {
    throw AppError.unprocessable(
      'DELIVERY_DESTINATION_REQUIRED',
      'El comprobante no tiene un destino registrado. Indique "destination" en el cuerpo de la solicitud.',
    );
  }

  const delivery: DeliveryRecord = {
    channel,
    destination: target,
    sentAt: new Date().toISOString(),
  };

  // Cada reenvio es una fila nueva: dos reenvios simultaneos no se pisan entre
  // si, por eso ya no hace falta serializarlos.
  await repository.addDelivery(receipt.receiptId, delivery);
  receipt.deliveries.push(delivery);

  console.info(
    `[reenvio] tripId=${receipt.tripId} comprobante=${receipt.receiptNumber} canal=${channel} destino=${maskDestination(target)}`,
  );

  return { receipt, delivery };
}

function buildReceipt(request: ReceiptRequest): Receipt {
  const receiptId = randomUUID();
  const issuedAt = request.issuedAt ? new Date(request.issuedAt) : new Date();

  return {
    receiptId,
    receiptNumber: buildReceiptNumber(issuedAt, receiptId),
    tripId: request.tripId,
    issuedAt: issuedAt.toISOString(),
    customer: request.customer,
    driver: request.driver,
    trip: request.trip,
    fare: request.fare,
    payment: request.payment,
    deliveries: [],
  };
}

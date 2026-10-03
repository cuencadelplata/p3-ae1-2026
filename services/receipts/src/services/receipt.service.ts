import { randomUUID } from 'node:crypto';

import { AppError } from '../errors/app-error';
import { fiscalClient } from '../integrations/fiscal-authorizer';
import { buildReceiptIssuedEvent } from '../messaging/receipt-issued';
import type { DeliveryChannel, DeliveryRecord, Receipt, ReceiptRequest } from '../models/receipt';
import * as repository from '../repositories/receipt.repository';
import { createLogger } from '../observability/logger';
import { buildReceiptNumber } from '../utils/identifiers';
import { createDownloadLink, resolveDownloadLink, type DownloadLink } from './download-link.service';
import { renderReceiptPdf } from './pdf.service';
import {
  acquireResendLock,
  checkResendRateLimit,
  getCachedReceipt,
  invalidateReceiptCache,
  setCachedReceipt,
} from './resend-protection.service';

const log = createLogger('receipts');

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
 *
 * Errores que puede propagar ademas de los de la base:
 * - DependencyUnavailableError: el autorizador fiscal no responde o su
 *   circuito esta abierto. El pedido se puede repetir mas tarde.
 * - FiscalAuthorizationRejectedError: el autorizador rechazo el comprobante.
 */
export async function issueReceipt(request: ReceiptRequest): Promise<IssueResult> {
  const existing = await repository.findByTripId(request.tripId);
  if (existing) {
    return { receipt: existing, created: false };
  }

  const receipt = buildReceipt(request);

  // La autorizacion se pide antes de generar el PDF porque el codigo va impreso
  // en el documento. Si el autorizador no esta disponible, no se persiste nada
  // y el pedido se puede repetir (idempotente por tripId en ambos lados).
  receipt.fiscal = await fiscalClient.authorize({
    tripId: receipt.tripId,
    issuedAt: receipt.issuedAt,
    currency: receipt.fare.currency,
    total: receipt.fare.total,
  });

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
  // RF-8.4: 1. Lectura cacheada en Redis
  const cached = await getCachedReceipt(tripId);
  if (cached) {
    return cached;
  }

  // 2. Consulta en CommunicationsDB si hubo cache miss
  const receipt = await repository.findByTripId(tripId);
  if (!receipt) {
    throw AppError.notFound('RECEIPT_NOT_FOUND', `No existe un comprobante emitido para el viaje ${tripId}`);
  }

  // 3. Poblar cache en Redis con TTL
  await setCachedReceipt(receipt);
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
 * Registra un nuevo envio del comprobante ya emitido (RF-8.4 - Lucas Cremaschi).
 *
 * Integra obligatoriamente Redis para:
 * 1. Aplicar rate limiting para evitar abusos en la solicitud de envio.
 * 2. Bloqueo distribuido (lock) para asegurar que multiples clics en "Reenviar"
 *    no disparen procesos paralelos concurrentes.
 * 3. Actualizacion / invalidacion de la cache de metadatos en Redis.
 *
 * Persistencia final auditable en CommunicationsDB (receipts.receipt_deliveries).
 */
export async function resendReceipt(
  tripId: string,
  channel: DeliveryChannel,
  destination?: string,
): Promise<{ receipt: Receipt; delivery: DeliveryRecord }> {
  // 1. Rate limiting en Redis (RF-8.4)
  const rateLimit = await checkResendRateLimit(tripId);
  if (!rateLimit.allowed) {
    throw AppError.tooManyRequests(
      'RATE_LIMIT_EXCEEDED',
      `Ha superado el limite maximo de solicitudes de reenvio para el viaje ${tripId}. Intente nuevamente en ${rateLimit.retryAfterSeconds} segundos.`,
      { retryAfterSeconds: rateLimit.retryAfterSeconds },
    );
  }

  // 2. Lock distribuido en Redis ante reenvios concurrentes (RF-8.4)
  const lock = await acquireResendLock(tripId);
  if (!lock.acquired) {
    throw AppError.conflict(
      'CONCURRENT_RESEND_IN_PROGRESS',
      `Ya existe un reenvio en curso para el viaje ${tripId}. Evite clics simultaneos.`,
    );
  }

  try {
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

    // Persistencia final en CommunicationsDB
    await repository.addDelivery(receipt.receiptId, delivery);
    receipt.deliveries.push(delivery);

    // 3. Invalida la cache para que la proxima lectura refleje el nuevo reenvio
    await invalidateReceiptCache(tripId);

    // El destino (email, telefono o dispositivo) es un dato personal: no se registra en logs.
    log('info', 'reenvio registrado', { tripId: receipt.tripId, receiptNumber: receipt.receiptNumber, channel });

    return { receipt, delivery };
  } finally {
    // 4. Liberacion segura del lock distribuido
    await lock.release();
  }
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

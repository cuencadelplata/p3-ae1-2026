import { randomUUID } from 'node:crypto';

import { AppError } from '../errors/app-error';
import type { DeliveryChannel, DeliveryRecord, Receipt, ReceiptRequest } from '../models/receipt';
import * as repository from '../repositories/receipt.repository';
import { buildReceiptNumber, maskDestination } from '../utils/identifiers';
import { withLock } from '../utils/lock';
import { renderReceiptPdf } from './pdf.service';

export interface IssueResult {
  receipt: Receipt;
  created: boolean;
}

/**
 * Emite el comprobante de un viaje finalizado (RF-8.3).
 *
 * La operacion es idempotente por tripId: si el comprobante ya existe se
 * devuelve el mismo documento en lugar de emitir uno nuevo. El candado por
 * tripId serializa las solicitudes concurrentes dentro del proceso y el flag de
 * escritura exclusiva del repositorio cubre el caso de varias instancias.
 */
export async function issueReceipt(request: ReceiptRequest): Promise<IssueResult> {
  return withLock(request.tripId, async () => {
    const existing = await repository.findByTripId(request.tripId);
    if (existing) {
      return { receipt: existing, created: false };
    }

    const receipt = buildReceipt(request);
    const pdf = await renderReceiptPdf(receipt);

    try {
      await repository.create(receipt, pdf);
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
  });
}

export async function getReceipt(tripId: string): Promise<Receipt> {
  const receipt = await repository.findByTripId(tripId);
  if (!receipt) {
    throw AppError.notFound('RECEIPT_NOT_FOUND', `No existe un comprobante emitido para el viaje ${tripId}`);
  }
  return receipt;
}

export async function getReceiptPdfPath(tripId: string): Promise<{ receipt: Receipt; filePath: string }> {
  const receipt = await getReceipt(tripId);

  if (!(await repository.pdfExists(tripId))) {
    throw AppError.conflict(
      'RECEIPT_PDF_UNAVAILABLE',
      `El comprobante del viaje ${tripId} existe pero su archivo PDF no esta disponible`,
    );
  }

  return { receipt, filePath: repository.pdfPath(tripId) };
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
  return withLock(tripId, async () => {
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

    receipt.deliveries.push(delivery);
    await repository.update(receipt);

    console.info(
      `[reenvio] tripId=${receipt.tripId} comprobante=${receipt.receiptNumber} canal=${channel} destino=${maskDestination(target)}`,
    );

    return { receipt, delivery };
  });
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

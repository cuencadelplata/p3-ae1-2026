import type { RequestHandler } from 'express';

import { env } from '../config/env';
import { AppError } from '../errors/app-error';
import type { Receipt } from '../models/receipt';
import { pdfFileName } from '../repositories/receipt.repository';
import * as receiptService from '../services/receipt.service';
import { isValidTripId } from '../utils/identifiers';
import { validateReceiptRequest, validateResendRequest } from '../validators/receipt.validator';

function readTripId(raw: unknown): string {
  if (!isValidTripId(raw)) {
    throw AppError.badRequest(
      'INVALID_TRIP_ID',
      'El identificador de viaje solo admite letras, numeros, guion y guion bajo (hasta 64 caracteres)',
    );
  }
  return raw;
}

function toResponse(receipt: Receipt) {
  return {
    ...receipt,
    pdf: {
      downloadUrl: `${env.publicBaseUrl}${env.apiPrefix}/receipts/${receipt.tripId}/pdf`,
      staticUrl: `${env.publicBaseUrl}${env.staticPrefix}/${pdfFileName(receipt.tripId)}`,
    },
  };
}

/**
 * POST /receipts
 * Recibe los datos del viaje finalizado (M6) junto con la tarifa y el pago (M7)
 * y emite el comprobante en PDF. Es idempotente por tripId: si el comprobante ya
 * existe responde 200 con el documento vigente en lugar de emitir otro.
 */
export const createReceipt: RequestHandler = async (req, res, next) => {
  try {
    const validation = validateReceiptRequest(req.body);
    if (!validation.ok) {
      throw AppError.unprocessable(
        'VALIDATION_ERROR',
        'La solicitud contiene datos invalidos',
        validation.errors,
      );
    }

    const { receipt, created } = await receiptService.issueReceipt(validation.value);
    res.status(created ? 201 : 200).json({ data: toResponse(receipt) });
  } catch (error) {
    next(error);
  }
};

/** GET /receipts/:tripId - devuelve los metadatos del comprobante y sus enlaces. */
export const getReceipt: RequestHandler = async (req, res, next) => {
  try {
    const tripId = readTripId(req.params['tripId']);
    const receipt = await receiptService.getReceipt(tripId);
    res.status(200).json({ data: toResponse(receipt) });
  } catch (error) {
    next(error);
  }
};

/** GET /receipts/:tripId/pdf - descarga controlada del archivo generado. */
export const downloadReceipt: RequestHandler = async (req, res, next) => {
  try {
    const tripId = readTripId(req.params['tripId']);
    const { receipt, filePath } = await receiptService.getReceiptPdfPath(tripId);

    res.type('application/pdf');
    res.download(filePath, `comprobante-${receipt.receiptNumber}.pdf`, (error) => {
      if (error && !res.headersSent) {
        next(error);
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /receipts/:tripId/resend
 * Vuelve a solicitar el envio del comprobante (RF-8.4). En AE1 la entrega se
 * simula y se registra en el historial del comprobante.
 */
export const resendReceipt: RequestHandler = async (req, res, next) => {
  try {
    const tripId = readTripId(req.params['tripId']);

    const validation = validateResendRequest(req.body);
    if (!validation.ok) {
      throw AppError.unprocessable(
        'VALIDATION_ERROR',
        'La solicitud de reenvio contiene datos invalidos',
        validation.errors,
      );
    }

    const { receipt, delivery } = await receiptService.resendReceipt(
      tripId,
      validation.value.channel,
      validation.value.destination,
    );

    res.status(202).json({ data: { ...toResponse(receipt), lastDelivery: delivery } });
  } catch (error) {
    next(error);
  }
};

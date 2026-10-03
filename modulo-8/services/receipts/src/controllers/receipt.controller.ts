import type { RequestHandler, Response } from 'express';

import { env } from '../config/env';
import { AppError } from '../errors/app-error';
import { authorizeReceiptPermission } from '../middlewares/auth.middleware';
import type { Receipt } from '../models/receipt';
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
    authorizeReceiptPermission(receipt, req.usuarioAutenticado);
    res.status(200).json({ data: toResponse(receipt) });
  } catch (error) {
    next(error);
  }
};

function sendPdf(res: Response, receipt: Receipt, pdf: Buffer): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="comprobante-${receipt.receiptNumber}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).send(pdf);
}

/** GET /receipts/:tripId/pdf - descarga controlada del archivo generado. */
export const downloadReceipt: RequestHandler = async (req, res, next) => {
  try {
    const tripId = readTripId(req.params['tripId']);
    const { receipt, pdf } = await receiptService.getReceiptPdf(tripId);
    authorizeReceiptPermission(receipt, req.usuarioAutenticado);
    sendPdf(res, receipt, pdf);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /receipts/downloads/:token
 * Descarga mediante enlace temporal. Un enlace vencido o inexistente responde 410.
 */
export const downloadByToken: RequestHandler = async (req, res, next) => {
  try {
    const { receipt, pdf } = await receiptService.getReceiptPdfByToken(String(req.params['token']));
    sendPdf(res, receipt, pdf);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /internal/receipts/:tripId/delivery-reference
 * Contrato interno con Receipts Delivery (RF-8.4): devuelve un enlace temporal
 * al PDF y su vencimiento. No forma parte de la API publica.
 */
export const getDeliveryReference: RequestHandler = async (req, res, next) => {
  try {
    const tripId = readTripId(req.params['tripId']);
    const reference = await receiptService.getDeliveryReference(tripId);
    res.status(200).json({ data: reference });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /receipts/:tripId/resend
 * Vuelve a solicitar el envio del comprobante (RF-8.4 - Lucas Cremaschi).
 * Aplica validacion de permisos M1, bloqueo distribuido y rate limiting en Redis.
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

    const receiptCurrent = await receiptService.getReceipt(tripId);
    authorizeReceiptPermission(receiptCurrent, req.usuarioAutenticado);

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

/**
 * POST /receipts/resend
 * Endpoint de reenvio que recibe tripId en el cuerpo JSON (RF-8.4 - Lucas Cremaschi).
 */
export const resendReceiptWithBody: RequestHandler = async (req, res, next) => {
  try {
    const tripId = readTripId(req.body?.tripId ?? req.params['tripId']);

    const validation = validateResendRequest(req.body);
    if (!validation.ok) {
      throw AppError.unprocessable(
        'VALIDATION_ERROR',
        'La solicitud de reenvio contiene datos invalidos',
        validation.errors,
      );
    }

    const receiptCurrent = await receiptService.getReceipt(tripId);
    authorizeReceiptPermission(receiptCurrent, req.usuarioAutenticado);

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

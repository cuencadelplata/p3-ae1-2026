import PDFDocument from 'pdfkit';

import { env } from '../config/env';
import type { Fare, Receipt } from '../models/receipt';
import {
  formatCurrency,
  formatDateTime,
  formatDistance,
  formatDuration,
  labelForPaymentMethod,
  labelForPaymentStatus,
  labelForVehicleType,
} from '../utils/format';

type Doc = InstanceType<typeof PDFDocument>;
type Row = [label: string, value: string];

const MARGIN = 48;
const COLUMN_GAP = 24;
const FOOTER_HEIGHT = 56;

const COLOR_ACCENT = '#0f4c81';
const COLOR_TEXT = '#1f2933';
const COLOR_MUTED = '#6b7280';
const COLOR_LINE = '#d7dce2';
const COLOR_PANEL = '#f3f5f8';

/** Genera el comprobante en PDF y lo devuelve en memoria (RF-8.3). */
export function renderReceiptPdf(receipt: Receipt): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      info: {
        Title: `Comprobante de viaje ${receipt.receiptNumber}`,
        Author: env.issuerName,
        Subject: `Viaje ${receipt.tripId}`,
        Creator: env.serviceName,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      drawHeader(doc, receipt);
      drawParties(doc, receipt);
      drawTripSection(doc, receipt);
      drawFareTable(doc, receipt.fare);
      drawPaymentSection(doc, receipt);
      drawFooter(doc, receipt);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function contentWidth(doc: Doc): number {
  return doc.page.width - MARGIN * 2;
}

function drawHeader(doc: Doc, receipt: Receipt): void {
  const width = contentWidth(doc);
  const boxWidth = 190;

  doc
    .font('Helvetica-Bold')
    .fontSize(17)
    .fillColor(COLOR_ACCENT)
    .text(env.issuerName, MARGIN, MARGIN, { width: width - boxWidth - COLUMN_GAP });

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLOR_MUTED)
    .text(env.issuerTeam, { width: width - boxWidth - COLUMN_GAP });

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLOR_TEXT)
    .text('Comprobante de viaje', { width: width - boxWidth - COLUMN_GAP });

  const headerBottom = doc.y;
  const boxX = doc.page.width - MARGIN - boxWidth;

  doc.roundedRect(boxX, MARGIN, boxWidth, 62, 4).fill(COLOR_PANEL);

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLOR_MUTED)
    .text('NUMERO DE COMPROBANTE', boxX + 12, MARGIN + 10, { width: boxWidth - 24 });
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(COLOR_ACCENT)
    .text(receipt.receiptNumber, boxX + 12, doc.y + 1, { width: boxWidth - 24 });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLOR_MUTED)
    .text('FECHA DE EMISION', boxX + 12, doc.y + 6, { width: boxWidth - 24 });
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(COLOR_TEXT)
    .text(formatDateTime(receipt.issuedAt), boxX + 12, doc.y + 1, { width: boxWidth - 24 });

  const cursor = Math.max(headerBottom, MARGIN + 62) + 14;
  horizontalRule(doc, cursor);
  doc.x = MARGIN;
  doc.y = cursor + 14;
}

function drawParties(doc: Doc, receipt: Receipt): void {
  const width = contentWidth(doc);
  const columnWidth = (width - COLUMN_GAP) / 2;
  const top = doc.y;

  const customerRows: Row[] = [
    ['Nombre', receipt.customer.fullName],
    ['Identificador', receipt.customer.id],
  ];
  if (receipt.customer.documentId) {
    customerRows.push(['Documento', receipt.customer.documentId]);
  }
  if (receipt.customer.email) {
    customerRows.push(['Email', receipt.customer.email]);
  }

  const vehicle = receipt.driver.vehicle;
  const driverRows: Row[] = [
    ['Nombre', receipt.driver.fullName],
    ['Identificador', receipt.driver.id],
    ['Vehiculo', `${labelForVehicleType(vehicle.type)}${vehicle.model ? ` - ${vehicle.model}` : ''}`],
    ['Dominio', vehicle.plate],
  ];

  const leftBottom = drawBlock(doc, 'Cliente', customerRows, MARGIN, top, columnWidth);
  const rightBottom = drawBlock(
    doc,
    'Conductor y vehiculo',
    driverRows,
    MARGIN + columnWidth + COLUMN_GAP,
    top,
    columnWidth,
  );

  doc.x = MARGIN;
  doc.y = Math.max(leftBottom, rightBottom) + 8;
}

function drawTripSection(doc: Doc, receipt: Receipt): void {
  const rows: Row[] = [
    ['Origen', receipt.trip.origin],
    ['Destino', receipt.trip.destination],
    ['Inicio', formatDateTime(receipt.trip.startedAt)],
    ['Fin', formatDateTime(receipt.trip.finishedAt)],
    ['Distancia', formatDistance(receipt.trip.distanceKm)],
    ['Duracion', formatDuration(receipt.trip.durationMin)],
  ];

  const width = contentWidth(doc);
  const columnWidth = (width - COLUMN_GAP) / 2;
  const top = doc.y;

  sectionTitle(doc, 'Detalle del viaje', MARGIN, top, width);
  const contentTop = doc.y + 4;

  const left = rows.slice(0, 3);
  const right = rows.slice(3);

  const leftBottom = drawRows(doc, left, MARGIN, contentTop, columnWidth);
  const rightBottom = drawRows(doc, right, MARGIN + columnWidth + COLUMN_GAP, contentTop, columnWidth);

  doc.x = MARGIN;
  doc.y = Math.max(leftBottom, rightBottom) + 8;
}

function drawFareTable(doc: Doc, fare: Fare): void {
  const width = contentWidth(doc);
  const amountWidth = 130;
  const descriptionWidth = width - amountWidth;

  sectionTitle(doc, 'Detalle de tarifa', MARGIN, doc.y, width);

  let cursor = doc.y + 6;

  const items: Array<[string, number]> = [
    ['Tarifa base', fare.baseFare],
    ['Importe por distancia', fare.distanceAmount],
    ['Importe por tiempo', fare.timeAmount],
  ];
  if (fare.surcharges > 0) {
    items.push(['Recargos', fare.surcharges]);
  }
  if (fare.discounts > 0) {
    items.push(['Descuentos', -fare.discounts]);
  }

  const visibleItems = items.filter(([, amount]) => amount !== 0);

  for (const [description, amount] of visibleItems) {
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(COLOR_TEXT)
      .text(description, MARGIN, cursor, { width: descriptionWidth });
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(COLOR_TEXT)
      .text(formatCurrency(amount, fare.currency), MARGIN + descriptionWidth, cursor, {
        width: amountWidth,
        align: 'right',
      });
    cursor += 16;
  }

  if (visibleItems.length > 0) {
    horizontalRule(doc, cursor + 2);
    cursor += 10;
  }

  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(COLOR_TEXT)
    .text('Total', MARGIN, cursor, { width: descriptionWidth });
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(COLOR_ACCENT)
    .text(formatCurrency(fare.total, fare.currency), MARGIN + descriptionWidth, cursor - 1, {
      width: amountWidth,
      align: 'right',
    });

  doc.x = MARGIN;
  doc.y = cursor + 26;
}

function drawPaymentSection(doc: Doc, receipt: Receipt): void {
  const width = contentWidth(doc);
  const columnWidth = (width - COLUMN_GAP) / 2;

  const rows: Row[] = [
    ['Metodo de pago', labelForPaymentMethod(receipt.payment.method)],
    ['Estado', labelForPaymentStatus(receipt.payment.status)],
  ];
  if (receipt.payment.authorizationCode) {
    rows.push(['Codigo de autorizacion', receipt.payment.authorizationCode]);
  }

  const top = doc.y;
  sectionTitle(doc, 'Pago', MARGIN, top, width);
  const contentTop = doc.y + 4;

  const leftBottom = drawRows(doc, rows.slice(0, 2), MARGIN, contentTop, columnWidth);
  const rightBottom = drawRows(
    doc,
    rows.slice(2),
    MARGIN + columnWidth + COLUMN_GAP,
    contentTop,
    columnWidth,
  );

  doc.x = MARGIN;
  doc.y = Math.max(leftBottom, rightBottom);
}

function drawFooter(doc: Doc, receipt: Receipt): void {
  const width = contentWidth(doc);
  const top = doc.page.height - MARGIN - FOOTER_HEIGHT;

  horizontalRule(doc, top);

  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(COLOR_MUTED)
    .text(
      'Documento de demostracion emitido con fines academicos. No constituye comprobante fiscal ni representa una operacion de pago real.',
      MARGIN,
      top + 10,
      { width, align: 'center' },
    );

  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(COLOR_MUTED)
    .text(`Viaje ${receipt.tripId} | Comprobante ${receipt.receiptId}`, MARGIN, doc.y + 4, {
      width,
      align: 'center',
    });
}

function sectionTitle(doc: Doc, title: string, x: number, y: number, width: number): void {
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(COLOR_ACCENT)
    .text(title.toUpperCase(), x, y, { width, characterSpacing: 0.6 });
}

function drawBlock(doc: Doc, title: string, rows: Row[], x: number, y: number, width: number): number {
  sectionTitle(doc, title, x, y, width);
  return drawRows(doc, rows, x, doc.y + 4, width);
}

function drawRows(doc: Doc, rows: Row[], x: number, y: number, width: number): number {
  let cursor = y;

  for (const [label, value] of rows) {
    doc.font('Helvetica').fontSize(7.5).fillColor(COLOR_MUTED).text(label.toUpperCase(), x, cursor, { width });
    doc.font('Helvetica').fontSize(10).fillColor(COLOR_TEXT).text(value, x, doc.y + 1, { width });
    cursor = doc.y + 7;
  }

  return cursor;
}

function horizontalRule(doc: Doc, y: number): void {
  doc
    .moveTo(MARGIN, y)
    .lineTo(doc.page.width - MARGIN, y)
    .lineWidth(0.7)
    .strokeColor(COLOR_LINE)
    .stroke();
}

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { env } from '../config/env';
import type { Receipt } from '../models/receipt';
import { isValidTripId } from '../utils/identifiers';

/**
 * Persistencia transitoria en sistema de archivos (AE1). Los metadatos y los PDF
 * se guardan en directorios separados para que solo la carpeta de PDF pueda
 * publicarse como contenido estatico.
 *
 * En AE2 este repositorio se reemplaza por CommunicationsDB + almacenamiento de
 * objetos manteniendo la misma interfaz.
 */
export const metadataDirectory = path.join(env.storageDir, 'metadata');
export const pdfDirectory = path.join(env.storageDir, 'pdf');

export class ReceiptAlreadyExistsError extends Error {
  constructor(tripId: string) {
    super(`Ya existe un comprobante emitido para el viaje ${tripId}`);
    this.name = 'ReceiptAlreadyExistsError';
  }
}

function assertTripId(tripId: string): void {
  if (!isValidTripId(tripId)) {
    throw new Error(`Identificador de viaje invalido: ${tripId}`);
  }
}

export function pdfFileName(tripId: string): string {
  return `${tripId}.pdf`;
}

export function pdfPath(tripId: string): string {
  assertTripId(tripId);
  return path.join(pdfDirectory, pdfFileName(tripId));
}

function metadataPath(tripId: string): string {
  assertTripId(tripId);
  return path.join(metadataDirectory, `${tripId}.json`);
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

export async function ensureStorage(): Promise<void> {
  await fs.mkdir(metadataDirectory, { recursive: true });
  await fs.mkdir(pdfDirectory, { recursive: true });
}

export async function isStorageWritable(): Promise<boolean> {
  try {
    await fs.access(metadataDirectory, fs.constants.W_OK);
    await fs.access(pdfDirectory, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findByTripId(tripId: string): Promise<Receipt | null> {
  try {
    const raw = await fs.readFile(metadataPath(tripId), 'utf8');
    return JSON.parse(raw) as Receipt;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function pdfExists(tripId: string): Promise<boolean> {
  try {
    await fs.access(pdfPath(tripId));
    return true;
  } catch {
    return false;
  }
}

/**
 * Escribe el comprobante de forma atomica respecto de otros procesos: el
 * metadato se crea con el flag "wx", de modo que solo la primera escritura para
 * un tripId prospera. El PDF se materializa recien despues, con un rename sobre
 * un archivo temporal, para que nunca quede un PDF sin metadato asociado.
 */
export async function create(receipt: Receipt, pdf: Buffer): Promise<void> {
  await ensureStorage();
  const finalPdfPath = pdfPath(receipt.tripId);
  const temporaryPdfPath = `${finalPdfPath}.${process.pid}.${Date.now()}.tmp`;

  await fs.writeFile(temporaryPdfPath, pdf);

  try {
    await fs.writeFile(metadataPath(receipt.tripId), serialize(receipt), { flag: 'wx' });
  } catch (error) {
    await fs.rm(temporaryPdfPath, { force: true });
    if (errorCode(error) === 'EEXIST') {
      throw new ReceiptAlreadyExistsError(receipt.tripId);
    }
    throw error;
  }

  await fs.rename(temporaryPdfPath, finalPdfPath);
}

/** Actualiza los metadatos de un comprobante ya emitido (por ejemplo, sus reenvios). */
export async function update(receipt: Receipt): Promise<void> {
  await fs.writeFile(metadataPath(receipt.tripId), serialize(receipt), 'utf8');
}

function serialize(receipt: Receipt): string {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

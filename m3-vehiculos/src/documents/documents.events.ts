/*
import { EXCHANGE, getChannel } from "../config/rabbitClient.js";
import type { Documento } from "./documents-model.js";

export async function publicarDocumentoRegistrado(
  documento: Documento,
): Promise<void> {
  const channel = getChannel();
  const payload = JSON.stringify({
    documentId: documento.id,
    driverId: documento.driverId,
    tipoDocumento: documento.tipoDocumento,
    timestamp: new Date().toISOString(),
  });

  channel.publish(
    EXCHANGE,
    "documento.registrado",
    Buffer.from(payload),
    { contentType: "application/json", persistent: true }, // el mensaje sobrevive si RabbitMQ se reinicia
  );

  channel.publish(
    EXCHANGE,
    "documento.validacion.solicitada",
    Buffer.from(payload),
    { contentType: "application/json", persistent: true },
  );
}
*/

import { randomUUID } from "node:crypto";
import { EXCHANGE, getChannel } from "../config/rabbitClient.js";
import type { Documento } from "./documents-model.js";

export async function publicarDocumentoRegistrado(
  documento: Documento,
): Promise<void> {
  const channel = getChannel();

  // M8 necesita el userId numérico de M1, no un string cualquiera
  const driverId = Number(documento.driverId);
  if (!Number.isInteger(driverId)) {
    throw new Error(
      `driverId "${documento.driverId}" no es un userId numérico de M1`,
    );
  }

  const messageId = randomUUID();

  // Evento para M8 (envelope acordado)
  const envelope = {
    messageId,
    eventType: "DriverDocumentRegistered",
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId: documento.id,
    producer: "m3-conductores",
    data: {
      documentId: documento.id,
      driverId,
      tipoDocumento: documento.tipoDocumento,
    },
  };

  channel.publish(
    EXCHANGE,
    "documento.registrado",
    Buffer.from(JSON.stringify(envelope)),
    { contentType: "application/json", persistent: true, messageId },
  );

  // Evento interno de M3 (validación): se queda con el formato plano de antes
  const interno = JSON.stringify({
    documentId: documento.id,
    driverId: documento.driverId,
    tipoDocumento: documento.tipoDocumento,
    timestamp: new Date().toISOString(),
  });

  channel.publish(
    EXCHANGE,
    "documento.validacion.solicitada",
    Buffer.from(interno),
    { contentType: "application/json", persistent: true },
  );
}
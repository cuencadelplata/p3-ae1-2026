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

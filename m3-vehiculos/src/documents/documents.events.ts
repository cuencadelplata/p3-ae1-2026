import { getChannel } from "../config/rabbitmq.js";
import type { Documento } from "./documento-model.js";

export async function publicarDocumentoRegistrado(
  documento: Documento,
): Promise<void> {
  const channel = await getChannel();
  const payload = JSON.stringify({
    documentId: documento.id,
    driverId: documento.driverId,
    tipoDocumento: documento.tipoDocumento,
    timestamp: new Date().toISOString(),
  });

  channel.publish(
    "m3-drivers.events",
    "documento.registrado",
    Buffer.from(payload),
    { persistent: true }, // el mensaje sobrevive si RabbitMQ se reinicia
  );

  channel.publish(
    "m3-drivers.events",
    "documento.validacion.solicitada",
    Buffer.from(payload),
    { persistent: true },
  );
}

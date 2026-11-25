import { EXCHANGE, getChannel } from "../config/rabbitClient.js";
import {
  buscarDocumentoDeConductor,
  actualizarEstadoDocumento,
} from "./documents-repository.js";

const QUEUE_VALIDACION = "documentos.validacion";

export async function iniciarConsumidores(): Promise<void> {
  const channel = getChannel();

  // La notificación al conductor no se consume acá: la hace M8 escuchando
  // "documento.registrado" desde su propia cola.

  // --- Validación externa (simulada) ---
  await channel.assertQueue(QUEUE_VALIDACION, { durable: true });
  await channel.bindQueue(
    QUEUE_VALIDACION,
    EXCHANGE,
    "documento.validacion.solicitada",
  );

  channel.consume(QUEUE_VALIDACION, async (msg) => {
    if (!msg) return;
    try {
      const evento = JSON.parse(msg.content.toString());

      // Idempotencia: si el documento ya no está PENDIENTE, no lo reprocesamos
      const documento = await buscarDocumentoDeConductor(
        evento.driverId,
        evento.documentId,
      );
      if (documento && documento.estado === "PENDIENTE") {
        const nuevoEstado =
          process.env.VALIDACION_RECHAZA === "true" ? "RECHAZADO" : "APROBADO";
        await actualizarEstadoDocumento(evento.documentId, nuevoEstado);
        console.log(
          `[validación simulada] Documento ${evento.documentId} → ${nuevoEstado}`,
        );
      }
      channel.ack(msg);
    } catch (err) {
      console.error("Error procesando validación:", err);
      channel.nack(msg, false, true);
    }
  });
}

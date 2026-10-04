import { getChannel } from "../config/rabbitmq.js";
import { buscarDocumentoDeConductor } from "./documents-repository.js";
import { actualizarEstadoDocumento } from "./documents-repository.js"; // lo agregamos abajo

const QUEUE_NOTIFICACIONES = "documentos.notificaciones";
const QUEUE_VALIDACION = "documentos.validacion";

export async function iniciarConsumidores(): Promise<void> {
  const channel = await getChannel();

  // --- Flujo 1: simular notificación ---
  await channel.assertQueue(QUEUE_NOTIFICACIONES, { durable: true });
  await channel.bindQueue(
    QUEUE_NOTIFICACIONES,
    "m3-drivers.events",
    "documento.registrado",
  );

  channel.consume(QUEUE_NOTIFICACIONES, async (msg) => {
    if (!msg) return;
    try {
      const evento = JSON.parse(msg.content.toString());
      console.log(
        `[notificación simulada] Documento ${evento.documentId} registrado — se avisaría al conductor ${evento.driverId}`,
      );
      channel.ack(msg);
    } catch (err) {
      console.error("Error procesando notificación:", err);
      channel.nack(msg, false, false); // no reintenta infinito: descarta el mensaje malformado
    }
  });

  // --- Flujo 2: simular validación externa ---
  await channel.assertQueue(QUEUE_VALIDACION, { durable: true });
  await channel.bindQueue(
    QUEUE_VALIDACION,
    "m3-drivers.events",
    "documento.validacion.solicitada",
  );

  channel.consume(QUEUE_VALIDACION, async (msg) => {
    if (!msg) return;
    try {
      const evento = JSON.parse(msg.content.toString());

      // Idempotencia: si el documento ya no está PENDIENTE, no lo reprocesamos
      // evita que un reintento pise un estado ya definitivo!!!!!
      const documento = await buscarDocumentoDeConductor(
        evento.driverId,
        evento.documentId,
      );
      if (documento && documento.estado === "PENDIENTE") {
        const nuevoEstado = Math.random() > 0.2 ? "APROBADO" : "RECHAZADO"; // simulación
        await actualizarEstadoDocumento(evento.documentId, nuevoEstado);
        console.log(
          `[validación simulada] Documento ${evento.documentId} → ${nuevoEstado}`,
        );
      }
      channel.ack(msg);
    } catch (err) {
      console.error("Error procesando validación:", err);
      channel.nack(msg, false, true); // este sí reintenta
    }
  });
}

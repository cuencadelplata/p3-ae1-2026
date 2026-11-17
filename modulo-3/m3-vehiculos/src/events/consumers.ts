import { EXCHANGE, getChannel } from "../config/rabbitClient.js";

// Los consumidores de documentos (notificación y validación) viven en
// src/documents/documents-consumers.ts
export async function iniciarConsumidores() {
  const channel = getChannel();

  // --- Notificación al conductor cuando se crea un vehículo ---
  const colaVehiculo = "notificaciones.vehiculo.creado";
  await channel.assertQueue(colaVehiculo, { durable: true });
  await channel.bindQueue(colaVehiculo, EXCHANGE, "vehiculo.creado");

  channel.consume(colaVehiculo, (msg) => {
    if (!msg) return;
    const evento = JSON.parse(msg.content.toString());
    console.log(
      `[rabbitmq] Notificación: vehículo ${evento.data.patente} creado para el conductor ${evento.data.driverId}`,
    );
    channel.ack(msg);
  });

  console.log("[rabbitmq] Consumidores iniciados: vehiculo.creado");
}

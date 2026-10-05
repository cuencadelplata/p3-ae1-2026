import { EXCHANGE, getChannel } from "../config/rabbitClient.js";

export async function iniciarConsumidores() {
  const channel = getChannel();

  // --- Flujo 1: notificación al conductor cuando se crea un vehículo ---
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

  // --- Flujo 2: validación asíncrona cuando se sube un documento ---
  const colaDocumento = "validacion.documento.subido";
  await channel.assertQueue(colaDocumento, { durable: true });
  await channel.bindQueue(colaDocumento, EXCHANGE, "documento.subido");

  channel.consume(colaDocumento, (msg) => {
    if (!msg) return;
    const evento = JSON.parse(msg.content.toString());
    console.log(
      `[rabbitmq] Validación disparada para documento ${evento.data.tipoDocumento} (${evento.data.numeroDocumento}) del conductor ${evento.data.driverId}`,
    );
    channel.ack(msg);
  });

  console.log("[rabbitmq] Consumidores iniciados: vehiculo.creado, documento.subido");
}
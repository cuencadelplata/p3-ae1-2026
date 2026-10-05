import { EXCHANGE, getChannel } from "../config/rabbitClient.js";

export function publicarVehiculoCreado(vehiculo: {
  id: string;
  driverId: string;
  patente: string;
  tipoServicio: string;
}) {
  try {
    const channel = getChannel();
    const payload = {
      evento: "vehiculo.creado",
      timestamp: new Date().toISOString(),
      data: vehiculo,
    };
    channel.publish(
      EXCHANGE,
      "vehiculo.creado",
      Buffer.from(JSON.stringify(payload)),
      { contentType: "application/json", persistent: true },
    );
  } catch (err) {
    // Si falla RabbitMQ, no bloqueamos la creación del vehículo
    console.error("[rabbitmq] Error publicando vehiculo.creado:", err);
  }
}

export function publicarDocumentoSubido(documento: {
  id: string;
  driverId: string;
  tipoDocumento: string;
  numeroDocumento: string;
}) {
  try {
    const channel = getChannel();
    const payload = {
      evento: "documento.subido",
      timestamp: new Date().toISOString(),
      data: documento,
    };
    channel.publish(
      EXCHANGE,
      "documento.subido",
      Buffer.from(JSON.stringify(payload)),
      { contentType: "application/json", persistent: true },
    );
  } catch (err) {
    console.error("[rabbitmq] Error publicando documento.subido:", err);
  }
}
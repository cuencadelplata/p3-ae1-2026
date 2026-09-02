import * as amqp from 'amqplib';
import { Connection, Channel } from 'amqplib';
import { NotificationServiceMock } from '../mocks/notification.mock.js';
import { DocumentServiceMock } from '../mocks/document.mock.js';
import { ticketRepository } from '../models/ticket.model.js';

export class RabbitMQConsumer {
  private static connection: any = null;
  private static channel: any = null;
  private static readonly QUEUE_NAME = 'm8_async_events';
  private static readonly EXCHANGE_NAME = 'viajes_exchange';

  static async connect(url: string = 'amqp://localhost:5672') {
    try {
      console.log(`[RabbitMQ] Conectando a ${url}...`);
      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();

      // Aseguramos que el exchange y la cola existan (arquitectura resiliente)
      await this.channel!.assertExchange(this.EXCHANGE_NAME, 'topic', { durable: true });
      await this.channel!.assertQueue(this.QUEUE_NAME, { durable: true });

      // Escuchamos eventos clave (ej. viaje completado, conductor asignado)
      await this.channel!.bindQueue(this.QUEUE_NAME, this.EXCHANGE_NAME, 'viaje.*');

      console.log(`[RabbitMQ] Conectado exitosamente. Esperando mensajes en la cola: ${this.QUEUE_NAME}`);

      this.startConsuming();
    } catch (error) {
      console.error('[RabbitMQ] Error de conexión:', error);
      // En un entorno productivo usaríamos reintentos exponenciales
      setTimeout(() => this.connect(url), 5000);
    }
  }

  private static async startConsuming() {
    if (!this.channel) return;

    this.channel.consume(this.QUEUE_NAME, async (msg: any) => {
      if (!msg) return;

      try {
        const payload = JSON.parse(msg.content.toString());
        const routingKey = msg.fields.routingKey;

        console.log(`[RabbitMQ] Mensaje recibido [${routingKey}]:`, payload);

        // RF-8.6: Procesamos asíncronamente según el tipo de evento
        switch (routingKey) {
          case 'viaje.asignado':
            // Ej: Alguien del M5 asignó el viaje. Notificamos al cliente.
            await NotificationServiceMock.sendNotification(payload.viajeId, 'PUSH', 'Tu conductor está en camino');
            break;

          case 'viaje.iniciado':
            // Ej: El M6 marca el viaje como iniciado. Generamos QR.
            await DocumentServiceMock.generateQR(payload.viajeId);
            break;

          case 'viaje.completado':
            // Viaje finalizado (M6/M7). Generamos PDF de comprobante y notificamos.
            const pdfUrl = await DocumentServiceMock.generatePDF(payload.viajeId, payload.importe || 0);
            await NotificationServiceMock.sendNotification(payload.viajeId, 'EMAIL', `Tu comprobante está listo: ${pdfUrl}`);

            // Si el cliente había abierto un ticket para este viaje, podríamos cambiarle el estado o avisar
            // Aquí hay lógica cruzada entre nuestro 8.5 y 8.6
            const tickets = ticketRepository.listarTodos().filter(t => t.viajeId === payload.viajeId);
            if (tickets.length > 0) {
              console.log(`[RabbitMQ] El viaje completado tiene ${tickets.length} tickets asociados. Actualizando estados...`);
              // En un escenario real, podríamos resolverlos o disparar una alerta a soporte.
            }
            break;

          default:
            console.log(`[RabbitMQ] Evento no manejado: ${routingKey}`);
        }

        // Confirmamos (ACK) que el mensaje fue procesado para sacarlo de la cola
        this.channel!.ack(msg);
      } catch (error) {
        console.error('[RabbitMQ] Error procesando mensaje:', error);
        // Si hay error temporal, podríamos no hacer ack para que se reencole (NACK). 
        // En AE4 se pedirán reintentos, por ahora lo descartamos o logueamos.
        this.channel!.ack(msg);
      }
    });
  }
}

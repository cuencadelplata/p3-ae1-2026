import * as amqp from 'amqplib';
import { Connection, Channel } from 'amqplib';
import { NotificationServiceMock } from '../mocks/notification.mock.js';
import { DocumentServiceMock } from '../mocks/document.mock.js';
import { ticketRepository } from '../models/ticket.model.js';

export class RabbitMQConsumer {
  private static connection: any = null;
  private static channel: any = null;
  private static reconnectTimer: NodeJS.Timeout | null = null;
  private static readonly QUEUE_NAME = 'm8_async_events';
  private static readonly EXCHANGE_NAME = 'viajes_exchange';
  private static readonly RECONNECT_DELAY_MS = 5000;

  static async connect(url: string = 'amqp://localhost:5672') {
    let connection: any = null;
    try {
      console.log(`[RabbitMQ] Conectando a ${url}...`);
      connection = await amqp.connect(url);
      // Sin listener de 'error', Node termina el proceso cuando el broker se cae.
      connection.on('error', (error: unknown) => console.error('[RabbitMQ] Error en la conexión:', error));
      connection.on('close', () => this.handleDisconnect(connection, url));

      const channel = await connection.createChannel();
      channel.on('error', (error: unknown) => console.error('[RabbitMQ] Error en el canal:', error));
      channel.on('close', () => this.handleDisconnect(connection, url));

      // Aseguramos que el exchange y la cola existan (arquitectura resiliente)
      await channel.assertExchange(this.EXCHANGE_NAME, 'topic', { durable: true });
      await channel.assertQueue(this.QUEUE_NAME, { durable: true });

      // Escuchamos eventos clave (ej. viaje completado, ticket creado, etc.)
      await channel.bindQueue(this.QUEUE_NAME, this.EXCHANGE_NAME, 'viaje.#');
      await channel.bindQueue(this.QUEUE_NAME, this.EXCHANGE_NAME, 'ticket.#');

      this.connection = connection;
      this.channel = channel;
      console.log(`[RabbitMQ] Conectado exitosamente. Esperando mensajes en la cola: ${this.QUEUE_NAME}`);

      await this.startConsuming(channel);
    } catch (error) {
      console.error('[RabbitMQ] Error de conexión:', error);
      this.connection = null;
      this.channel = null;
      this.closeQuietly(connection);
      this.scheduleReconnect(url);
    }
  }

  // Un canal o una conexión cerrados nunca deben terminar el proceso: los
  // tickets (RF-8.5) siguen funcionando sin broker.
  private static handleDisconnect(connection: any, url: string) {
    // Ya atendido, o evento tardío de una conexión descartada.
    if (this.connection !== connection) return;

    console.error(`[RabbitMQ] Conexión o canal cerrados. Reintentando en ${this.RECONNECT_DELAY_MS / 1000}s...`);
    this.connection = null;
    this.channel = null;
    this.closeQuietly(connection);
    this.scheduleReconnect(url);
  }

  private static scheduleReconnect(url: string) {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(url);
    }, this.RECONNECT_DELAY_MS);
  }

  private static closeQuietly(connection: any) {
    if (!connection) return;
    try {
      Promise.resolve(connection.close()).catch(() => undefined);
    } catch {
      // Ya estaba cerrada.
    }
  }

  private static safeAck(channel: any, msg: any) {
    try {
      channel.ack(msg);
    } catch (error) {
      console.error('[RabbitMQ] No se pudo confirmar el mensaje (canal cerrado):', error);
    }
  }

  /**
   * Publica un evento asíncrono a RabbitMQ en el exchange 'viajes_exchange'
   */
  static async publishEvent(routingKey: string, payload: any): Promise<boolean> {
    if (!this.channel) {
      // Si el canal no está listo (ej. en tests sin broker), continuamos sin error
      return false;
    }
    try {
      const buffer = Buffer.from(JSON.stringify(payload));
      this.channel.publish(this.EXCHANGE_NAME, routingKey, buffer);
      console.log(`[RabbitMQ] Evento publicado exitosamente [${routingKey}]:`, payload);
      return true;
    } catch (error) {
      console.error('[RabbitMQ] Error publicando evento:', error);
      return false;
    }
  }

  private static async startConsuming(channel: any) {
    // Prefetch(1) asegura que RabbitMQ entregue solo 1 mensaje a la vez al consumidor,
    // manteniendo el resto en la cola ("Queued messages") para poderlos monitorear en el Dashboard.
    await channel.prefetch(1);

    await channel.consume(this.QUEUE_NAME, async (msg: any) => {
      if (!msg) return;

      try {
        const payload = JSON.parse(msg.content.toString());
        const routingKey = msg.fields.routingKey;

        console.log(`[RabbitMQ] 📥 Mensaje recibido [${routingKey}]:`, payload);

        // Retardo simulado para permitir monitorear el mensaje procesado en RabbitMQ Management.
        // Por defecto: 3000ms (3s). Desactivado en entorno de pruebas (0ms).
        const delayMs = process.env.NODE_ENV === 'test'
          ? 0
          : (Number(process.env.PROCESSING_DELAY_MS) || 3000);

        if (delayMs > 0) {
          console.log(`[RabbitMQ] ⏳ Procesando mensaje durante ${delayMs / 1000}s para monitoreo en RabbitMQ...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        // RF-8.6: Procesamos asíncronamente según el tipo de evento
        switch (routingKey) {
          case 'ticket.creado':
            // Al crearse un ticket desde Swagger/API, se procesa asíncronamente en RabbitMQ
            await NotificationServiceMock.sendNotification(
              payload.viajeId,
              'PUSH',
              `Ticket #${payload.id} recibido en soporte: ${payload.motivo}`
            );
            break;

          case 'ticket.actualizado':
            console.log(`[RabbitMQ] Notificación: Estado del ticket #${payload.id} actualizado a ${payload.estado}`);
            break;

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

            const tickets = (await ticketRepository.listarTodos()).filter(t => t.viajeId === payload.viajeId);
            if (tickets.length > 0) {
              console.log(`[RabbitMQ] El viaje completado tiene ${tickets.length} tickets asociados. Actualizando estados...`);
            }
            break;

          default:
            console.log(`[RabbitMQ] Evento procesado: ${routingKey}`);
        }

        console.log(`[RabbitMQ] ✅ Mensaje procesado exitosamente [${routingKey}] - Enviando ACK`);
      } catch (error) {
        console.error('[RabbitMQ] ❌ Error procesando mensaje:', error);
      }

      // Un único ACK, también ante error (semántica AE1), sobre el canal que
      // entregó el mensaje.
      this.safeAck(channel, msg);
    });
  }
}

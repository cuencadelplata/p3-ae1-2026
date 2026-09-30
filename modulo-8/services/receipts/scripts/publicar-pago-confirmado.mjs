/**
 * Demostracion del consumo asincronico de payment.confirmed (RF-8.3 / RF-8.6).
 *
 * Publica en mobility.events, tal como lo haria M7:
 *   1. un pago confirmado valido               -> se emite el comprobante
 *   2. el mismo mensaje otra vez (mismo id)    -> se descarta como repetido
 *   3. un mensaje que no respeta el sobre      -> va a la DLQ sin reintentos
 *
 * Ademas escucha receipt.issued, como lo haria cualquier suscriptor, y muestra
 * que el servicio lo publica una unica vez aunque el pago llegue repetido.
 *
 * El paso 2 se publica despues de que el paso 1 termino, para que la bandeja de
 * entrada ya lo tenga registrado. Si ambos llegaran a la vez, los dos pasarian
 * esa primera verificacion y el repetido se detectaria en la segunda capa: la
 * restriccion UNIQUE por viaje ("comprobante ya existente").
 *
 * Uso: con el stack levantado (docker compose up -d en modulo-8), ejecutar
 * `pnpm run demo:pago` y revisar `docker compose logs receipts` y la consola
 * de RabbitMQ en http://localhost:15672 (guest / guest).
 */
import { randomUUID } from 'node:crypto';

import amqp from 'amqplib';

const URL = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
const EXCHANGE = process.env.EVENTS_EXCHANGE ?? 'mobility.events';
const ROUTING_KEY = 'payment.confirmed';
const ISSUED_ROUTING_KEY = 'receipt.issued';
const BASE = process.env.BASE_URL ?? 'http://localhost:3008';
const LINEA = '='.repeat(72);

const tripId = `trip-demo-${Date.now()}`;
const messageId = randomUUID();

const evento = {
  messageId,
  eventType: 'PaymentConfirmed',
  version: 1,
  occurredAt: new Date().toISOString(),
  correlationId: tripId,
  producer: 'm7-pagos',
  data: {
    tripId,
    paymentId: `pay-${Date.now()}`,
    confirmedAt: new Date().toISOString(),
    method: 'TARJETA',
    status: 'APROBADO',
    authorizationCode: 'AUT-55821',
    fare: {
      currency: 'ARS',
      baseFare: 1200,
      distanceAmount: 3450.5,
      timeAmount: 890,
      surcharges: 0,
      discounts: 150,
      total: 5390.5,
    },
    customer: { id: 'cli-0091', fullName: 'Lucia Fernandez', email: 'lucia.fernandez@example.com' },
    driver: {
      id: 'cnd-0457',
      fullName: 'Martin Rodriguez',
      vehicle: { type: 'AUTO', plate: 'AB123CD', model: 'Toyota Etios 2021' },
    },
    trip: {
      origin: 'Av. Colon 1250',
      destination: 'Aeropuerto',
      startedAt: new Date(Date.now() - 31 * 60_000).toISOString(),
      finishedAt: new Date().toISOString(),
      distanceKm: 14.8,
      durationMin: 31,
    },
  },
};

function publicar(channel, contenido, id) {
  channel.publish(EXCHANGE, ROUTING_KEY, Buffer.from(contenido), {
    persistent: true,
    contentType: 'application/json',
    messageId: id,
  });
}

async function esperarComprobante() {
  for (let intento = 0; intento < 20; intento++) {
    const respuesta = await fetch(`${BASE}/api/v1/receipts/${tripId}`).catch(() => null);
    if (respuesta?.ok) {
      return (await respuesta.json()).data;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function main() {
  const connection = await amqp.connect(URL);
  const channel = await connection.createConfirmChannel();

  // Cola temporal del suscriptor: se borra sola al cerrar la conexion.
  const emitidos = [];
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  const { queue } = await channel.assertQueue('', { exclusive: true, autoDelete: true });
  await channel.bindQueue(queue, EXCHANGE, ISSUED_ROUTING_KEY);
  await channel.consume(
    queue,
    (mensaje) => {
      const recibido = mensaje && JSON.parse(mensaje.content.toString('utf8'));
      if (recibido?.correlationId === tripId) {
        emitidos.push(recibido);
      }
    },
    { noAck: true },
  );

  console.log(LINEA);
  console.log(' DEMO payment.confirmed -> comprobante (RF-8.3 / RF-8.6)');
  console.log(LINEA);
  console.log(` Fecha     : ${new Date().toLocaleString('es-AR')}`);
  console.log(` Exchange  : ${EXCHANGE}  routing key: ${ROUTING_KEY}`);
  console.log(` tripId    : ${tripId}`);
  console.log(` messageId : ${messageId}`);
  console.log('-'.repeat(72));

  publicar(channel, JSON.stringify(evento), messageId);
  await channel.waitForConfirms();
  console.log(' 1. Publicado pago confirmado valido');

  const comprobante = await esperarComprobante();
  // Pausa breve para que el mensaje quede registrado en la bandeja de entrada.
  await new Promise((resolve) => setTimeout(resolve, 500));

  publicar(channel, JSON.stringify(evento), messageId);
  console.log(' 2. Publicado el MISMO mensaje otra vez (reentrega)');
  publicar(channel, '{"esto": "no respeta el sobre"}', `demo-invalido-${Date.now()}`);
  console.log(' 3. Publicado un mensaje invalido');
  await channel.waitForConfirms();

  // Margen para que un segundo receipt.issued, si lo hubiera, llegue a verse.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await connection.close();

  console.log('-'.repeat(72));
  if (comprobante) {
    console.log(` Comprobante emitido : ${comprobante.receiptNumber}`);
    console.log(` Descarga del PDF    : ${comprobante.pdf.downloadUrl}`);
    console.log(` receipt.issued      : ${emitidos.length} recibido(s) para este viaje (se espera 1)`);
    for (const evento of emitidos) {
      console.log(`   messageId=${evento.messageId} data=${JSON.stringify(evento.data)}`);
    }
  } else {
    console.log(` No se encontro el comprobante en ${BASE}. Revisar docker compose logs receipts`);
  }
  console.log(LINEA);
  console.log(' Verificar:');
  console.log('  - docker compose logs receipts : "emitido", "repetido descartado", "DLQ" y "evento publicado"');
  console.log('  - http://localhost:15672 -> Queues -> m8.receipts.payment-confirmed.dlq (1 mensaje)');
  console.log(LINEA);
}

main().catch((error) => {
  console.error(`\nNo se pudo ejecutar la demo: ${error.message}`);
  console.error('Asegurate de tener el stack levantado: docker compose up -d (en modulo-8)\n');
  process.exit(1);
});

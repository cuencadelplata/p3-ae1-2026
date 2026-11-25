#!/usr/bin/env node
// Prueba por cantidad de eventos: node tests/stress/run-m3-batch.mjs 600
// Simula M3 -> RabbitMQ -> M8 y verifica una notificacion, un Inbox procesado,
// una solicitud de entrega y un intento PUSH sandbox por evento.
// Repite hasta diez mensajes para comprobar que no generen efectos adicionales.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as amqp from 'amqplib';
import dotenv from 'dotenv';
import pg from 'pg';

const moduleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Lee la configuracion privada de M8. Usa la cantidad indicada, o 50 por defecto.
dotenv.config({ path: path.join(moduleDir, '.env'), quiet: true });
const total = Number(process.argv[2] || process.env.AMQP_MESSAGES || 50);
// Es el tiempo maximo de espera del procesamiento, no la duracion de la carga.
const timeoutSeconds = Number(process.env.AMQP_TIMEOUT_SECONDS || 120);
if (!Number.isInteger(total) || total < 1 || total > 600
  || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 300) {
  console.error('AMQP_MESSAGES: 1..600; AMQP_TIMEOUT_SECONDS: 10..300.');
  process.exit(2);
}
// Detiene la prueba si faltan credenciales o siguen los marcadores de la plantilla.
for (const name of ['RABBITMQ_URL', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'M1_JWT_SECRET']) {
  if (!process.env[name] || process.env[name].startsWith('replace-with-')) {
    console.error(`Configurar ${name} en modulo8/.env.`);
    process.exit(2);
  }
}

// Destinatario de prueba. Los UUID permiten distinguir este lote de otros.
const driverId = 42;
const base = `http://127.0.0.1:${Number(process.env.M8_HOST_PORT || 8000)}`;
const deviceToken = `sandbox-load-m3-${randomUUID()}`;
const messageIds = Array.from({ length: total }, () => randomUUID());
// Consulta la base de M8 para verificar los resultados reales del procesamiento.
const db = new pg.Pool({
  host: '127.0.0.1', port: Number(process.env.POSTGRES_HOST_PORT || 5432),
  database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD, max: 2,
});

// Firma un JWT local de prueba para registrar y desactivar el token del dispositivo.
// No inicia sesion en el M1 real; se usa en el entorno aislado con sandbox.
function jwt() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    userId: driverId, role: 'CONDUCTOR', exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const signature = createHmac('sha256', process.env.M1_JWT_SECRET)
    .update(`${header}.${payload}`).digest('base64url');
  return `Bearer ${header}.${payload}.${signature}`;
}

// Cuenta solo los registros asociados a los messageId de esta ejecucion.
// Los datos que ya existian en la base no alteran las comprobaciones del lote.
async function counts() {
  const [notifications, inbox, deliveries] = await Promise.all([
    db.query('SELECT count(*)::int AS count FROM notifications.notifications WHERE source_message_id = ANY($1::text[])', [messageIds]),
    db.query(`SELECT count(*)::int AS count FROM messaging.inbox_events
      WHERE consumer_id = 'm8.notificaciones.documento-registrado'
      AND status = 'PROCESSED' AND message_id = ANY($1::text[])`, [messageIds]),
    db.query(`SELECT count(*)::int AS requests,
      (SELECT count(*)::int FROM notification_delivery.delivery_attempts a
        JOIN notification_delivery.delivery_requests d ON d.delivery_id = a.delivery_id
        JOIN notifications.notifications n ON n.notification_id::text = d.notification_id
        WHERE n.source_message_id = ANY($1::text[])) AS attempts
      FROM notification_delivery.delivery_requests d
      JOIN notifications.notifications n ON n.notification_id::text = d.notification_id
      WHERE n.source_message_id = ANY($1::text[])`, [messageIds]),
  ]);
  return {
    notifications: notifications.rows[0].count,
    inboxProcessed: inbox.rows[0].count,
    deliveries: deliveries.rows[0].requests,
    attempts: deliveries.rows[0].attempts,
  };
}

let connection;
let channel;
let tokenRegistered = false;
// El tiempo medido incluye la preparacion y la espera del primer lote procesado.
const startedAt = new Date().toISOString();
const startNs = process.hrtime.bigint();
try {
  // Comprueba que M8 este listo y registra un dispositivo para recibir el PUSH sandbox.
  const health = await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(3000) });
  assert.equal(health.status, 200, 'M8 debe estar listo');
  const registration = await fetch(`${base}/devices/tokens`, {
    method: 'POST', headers: { authorization: jwt(), 'content-type': 'application/json' },
    body: JSON.stringify({ token: deviceToken, platform: 'ANDROID' }),
  });
  assert.equal(registration.status, 201, 'Registrar device token sandbox');
  tokenRegistered = true;
  // Abre RabbitMQ con confirmaciones de publicacion y asegura el exchange de M3.
  connection = await amqp.connect(process.env.RABBITMQ_URL);
  channel = await connection.createConfirmChannel();
  await channel.assertExchange('m3.eventos', 'topic', { durable: true });

  // Construye eventos de documentos distintos para el mismo conductor de prueba.
  const events = messageIds.map((messageId) => {
    const documentId = randomUUID();
    return {
      messageId, eventType: 'DriverDocumentRegistered', version: 1,
      occurredAt: new Date().toISOString(), correlationId: documentId,
      producer: 'm3-conductores', data: { documentId, driverId, tipoDocumento: 'LICENCIA' }
    };
  });
  // Publica todo el lote. La confirmacion indica que RabbitMQ recibio los mensajes;
  // todavia falta comprobar que M8 los haya procesado.
  const publish = (event) => channel.publish('m3.eventos', 'documento.registrado',
    Buffer.from(JSON.stringify(event)), { persistent: true, contentType: 'application/json', messageId: event.messageId });
  for (const event of events) publish(event);
  await channel.waitForConfirms();
  // Consulta cada 500 ms y termina la espera cuando todos los conteos coinciden.
  const deadline = Date.now() + timeoutSeconds * 1000;
  let observed;
  do {
    observed = await counts();
    if (observed.notifications === total && observed.inboxProcessed === total
      && observed.deliveries === total && observed.attempts === total) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  // Si falta algun efecto al vencer la espera, la prueba falla con los conteos observados.
  assert.deepEqual(observed, {
    notifications: total, inboxProcessed: total,
    deliveries: total, attempts: total
  }, 'Cada evento debe causar una notificacion y un intento sandbox');
  const processingSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;

  // Reenvia los mismos messageId, espera 1,5 s y verifica que no aumenten los conteos.
  for (const event of events.slice(0, Math.min(total, 10))) publish(event);
  await channel.waitForConfirms();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.deepEqual(await counts(), observed, 'Los duplicados no deben crear efectos');

  // Guarda el resumen JSON local y muestra su ruta, los conteos y el tiempo en terminal.
  // Grafana obtiene sus datos de /metrics mediante Alloy, no de este archivo.
  const report = {
    status: 'ok', scenario: 'M3 simulado -> RabbitMQ -> M8 -> PUSH sandbox',
    startedAt, finishedAt: new Date().toISOString(), messages: total,
    duplicateMessages: Math.min(total, 10), processingSeconds,
    messagesPerSecond: total / processingSeconds, ...observed
  };
  const resultsDir = path.join(moduleDir, 'tests/stress/results');
  mkdirSync(resultsDir, { recursive: true });
  const reportPath = path.join(resultsDir, `m3-batch-${startedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, resultFile: path.relative(moduleDir, reportPath) }));
} finally {
  // Incluso si la prueba falla, intenta desactivar el token y cerrar las conexiones.
  // Las notificaciones y los resultados generados permanecen guardados.
  if (tokenRegistered) {
    await fetch(`${base}/devices/tokens/${encodeURIComponent(deviceToken)}`, {
      method: 'DELETE', headers: { authorization: jwt() },
    }).catch(() => undefined);
  }
  if (channel) await channel.close().catch(() => undefined);
  if (connection) await connection.close().catch(() => undefined);
  await db.end();
}

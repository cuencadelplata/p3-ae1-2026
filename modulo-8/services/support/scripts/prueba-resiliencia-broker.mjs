/**
 * Resiliencia de Support (RF-8.5) frente a RabbitMQ, contra el stack real.
 *
 * Apaga de verdad el broker con "docker compose stop" mientras hay un mensaje
 * en proceso y verifica que Support sigue vivo, que la API de tickets responde
 * y que el consumer legacy vuelve a conectarse solo cuando el broker regresa.
 *
 * Requiere el stack levantado (docker compose up -d en modulo-8) y el CLI de
 * Docker. RabbitMQ se vuelve a iniciar siempre al terminar, aunque algo falle.
 *
 *   pnpm --filter m8-soporte run prueba:resiliencia
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const SUPPORT = process.env.SUPPORT_URL ?? 'http://localhost:3000';
const MODULE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// Retardo con el que el consumer legacy procesa cada mensaje fuera de tests.
const PROCESSING_DELAY_MS = 3000;

/** @param {string[]} args */
function docker(...args) {
  return execFileSync('docker', args, { cwd: MODULE_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** @param {string[]} args */
function compose(...args) {
  return docker('compose', ...args);
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {() => boolean | Promise<boolean>} check
 * @param {number} timeoutMs
 * @param {string} description
 */
async function waitFor(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      // Se reintenta hasta agotar el tiempo.
    }
    await sleep(1000);
  }
  assert.fail(`Tiempo agotado esperando: ${description}`);
}

/**
 * @param {string} method
 * @param {string} pathname
 * @param {unknown} [body]
 */
async function requestJson(method, pathname, body) {
  const response = await fetch(`${SUPPORT}${pathname}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

/** @param {string} viajeId */
function publish(viajeId) {
  return requestJson('POST', '/events/publish', {
    routingKey: 'viaje.completado',
    payload: { viajeId, importe: 2500 },
    count: 1,
  });
}

function rabbitIsReady() {
  compose('exec', '-T', 'rabbitmq', 'rabbitmq-diagnostics', '-q', 'ping');
  return true;
}

function supportStartedAt() {
  const containerId = compose('ps', '-q', 'support').trim();
  assert.notEqual(containerId, '', 'el contenedor de support debe existir');
  return docker('inspect', '-f', '{{.State.Running}} {{.State.StartedAt}}', containerId).trim();
}

const runId = `broker-${Date.now()}`;
/** @type {string} */
let startedAtBefore;

after(async () => {
  try {
    compose('start', 'rabbitmq');
    await waitFor(rabbitIsReady, 60000, 'RabbitMQ disponible tras la prueba');
  } catch (error) {
    console.error('No se pudo restaurar RabbitMQ: ejecutar "docker compose start rabbitmq".', error);
  }
});

test('punto de partida: Support responde y publica en el broker', async () => {
  const health = await requestJson('GET', '/health');
  assert.equal(health.status, 200);

  await waitFor(async () => (await publish(`${runId}-inicio`)).body.enviadosExitosamente >= 1, 30000, 'publicación inicial');
  startedAtBefore = supportStartedAt();
  assert.match(startedAtBefore, /^true /);
});

test('sin RabbitMQ, con un mensaje en proceso: Support sigue vivo y los tickets funcionan', async () => {
  // El mensaje queda en proceso durante el retardo del consumer: el ack llega
  // cuando el canal ya está cerrado, que es el caso que terminaba el proceso.
  await publish(`${runId}-en-vuelo`);
  compose('stop', 'rabbitmq');
  await sleep(PROCESSING_DELAY_MS + 2000);

  assert.equal(supportStartedAt(), startedAtBefore, 'support no debe haberse caído ni reiniciado');

  const health = await requestJson('GET', '/health');
  assert.equal(health.status, 200);

  const created = await requestJson('POST', '/tickets', { viajeId: `${runId}-ticket`, motivo: 'Broker detenido' });
  assert.equal(created.status, 201);

  const found = await requestJson('GET', `/tickets/${created.body.id}`);
  assert.equal(found.status, 200);
  assert.equal(found.body.id, created.body.id);

  const updated = await requestJson('PATCH', `/tickets/${created.body.id}/estado`, { estado: 'EN_PROCESO' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.estado, 'EN_PROCESO');

  const published = await publish(`${runId}-sin-broker`);
  assert.equal(published.status, 200);
  assert.equal(published.body.enviadosExitosamente, 0);
});

test('al volver RabbitMQ, Support reconecta sin reiniciarse', async () => {
  compose('start', 'rabbitmq');
  await waitFor(rabbitIsReady, 60000, 'RabbitMQ disponible');

  await waitFor(async () => (await publish(`${runId}-reconexion`)).body.enviadosExitosamente >= 1, 60000, 'reconexión de Support');

  assert.equal(supportStartedAt(), startedAtBefore, 'la reconexión no debe requerir reiniciar el contenedor');
});

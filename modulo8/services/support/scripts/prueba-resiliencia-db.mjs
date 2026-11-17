/**
 * Resiliencia de Support (RF-8.5) frente a PostgreSQL, contra el stack real.
 *
 * Apaga de verdad la base con "docker compose stop" y verifica que Support
 * sigue vivo, que la API de tickets responde 503 SUPPORT_DB_UNAVAILABLE rápido
 * en lugar de colgarse y que, cuando la base vuelve, todo se recupera sin
 * reiniciar el servicio y sin tickets ni historial a medias.
 *
 * Requiere el stack levantado (docker compose up -d en modulo-8) y el CLI de
 * Docker. PostgreSQL se vuelve a iniciar siempre al terminar, aunque algo falle.
 *
 *   pnpm --filter m8-soporte run prueba:resiliencia:db
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const SUPPORT = process.env.SUPPORT_URL ?? 'http://localhost:3000';
const POSTGRES_USER = process.env.POSTGRES_USER ?? 'm8_admin';
const POSTGRES_DB = process.env.POSTGRES_DB ?? 'm8';
const MODULE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// Un pedido con la base caída debe fallar dentro de este tiempo, no colgarse.
const RESPUESTA_RAPIDA_MS = 8000;

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
 * @param {Record<string, string>} [headers]
 */
async function requestJson(method, pathname, body, headers = {}) {
  const inicio = Date.now();
  const response = await fetch(`${SUPPORT}${pathname}`, {
    method,
    headers: body ? { 'content-type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json(), ms: Date.now() - inicio };
}

function postgresIsReady() {
  compose('exec', '-T', 'postgres', 'pg_isready', '-U', POSTGRES_USER, '-d', POSTGRES_DB);
  return true;
}

async function supportIsReady() {
  return (await requestJson('GET', '/health/ready')).body.status === 'ok';
}

function supportStartedAt() {
  const containerId = compose('ps', '-q', 'support').trim();
  assert.notEqual(containerId, '', 'el contenedor de support debe existir');
  return docker('inspect', '-f', '{{.State.Running}} {{.State.StartedAt}}', containerId).trim();
}

/**
 * @param {{ status: number, body: any, ms: number }} respuesta
 * @param {string} operacion
 */
function assertBaseNoDisponible(respuesta, operacion) {
  assert.equal(respuesta.status, 503, `${operacion} debe responder 503`);
  assert.equal(respuesta.body.error.code, 'SUPPORT_DB_UNAVAILABLE', operacion);
  assert.equal(typeof respuesta.body.correlationId, 'string', operacion);
  assert.ok(respuesta.ms < RESPUESTA_RAPIDA_MS, `${operacion} tardó ${respuesta.ms} ms: no debe colgarse`);
}

const runId = `db-${Date.now()}`;
const tripPrevio = `${runId}-previo`;
const tripDuranteLaCaida = `${runId}-caida`;
const claveDuranteLaCaida = `${runId}-clave`;
/** @type {string} */
let startedAtBefore;
/** @type {{ id: string, version: number, estado: string }} */
let ticketPrevio;

after(async () => {
  try {
    compose('start', 'postgres');
    await waitFor(postgresIsReady, 60000, 'PostgreSQL disponible tras la prueba');
  } catch (error) {
    console.error('No se pudo restaurar PostgreSQL: ejecutar "docker compose start postgres".', error);
  }
});

test('punto de partida: Support listo y con un ticket persistido', async () => {
  await waitFor(supportIsReady, 60000, 'Support con /health/ready en ok');

  const creado = await requestJson('POST', '/tickets', { tripId: tripPrevio, motivo: 'Antes de la caída' });
  assert.equal(creado.status, 201);
  const cambiado = await requestJson('PATCH', `/tickets/${creado.body.id}/estado`, { estado: 'EN_PROCESO' });
  assert.equal(cambiado.status, 200);

  ticketPrevio = cambiado.body;
  startedAtBefore = supportStartedAt();
  assert.match(startedAtBefore, /^true /);
});

test('sin PostgreSQL: Support sigue vivo y los tickets responden 503 rápido', async () => {
  compose('stop', 'postgres');

  const health = await requestJson('GET', '/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'OK');

  const live = await requestJson('GET', '/health/live');
  assert.equal(live.status, 200);

  const ready = await requestJson('GET', '/health/ready');
  assert.equal(ready.status, 503);
  assert.equal(ready.body.status, 'unavailable');
  assert.equal(ready.body.checks.postgres.status, 'unavailable');
  assert.ok(ready.ms < RESPUESTA_RAPIDA_MS, `/health/ready tardó ${ready.ms} ms`);

  assertBaseNoDisponible(
    await requestJson('POST', '/tickets', { tripId: tripDuranteLaCaida, motivo: 'Durante la caída' }),
    'POST /tickets',
  );
  assertBaseNoDisponible(
    await requestJson(
      'POST',
      '/tickets',
      { tripId: tripDuranteLaCaida, motivo: 'Durante la caída' },
      { 'Idempotency-Key': claveDuranteLaCaida },
    ),
    'POST /tickets con Idempotency-Key',
  );
  assertBaseNoDisponible(await requestJson('GET', '/tickets'), 'GET /tickets');
  assertBaseNoDisponible(await requestJson('GET', `/tickets/${ticketPrevio.id}`), 'GET /tickets/:id');
  assertBaseNoDisponible(
    await requestJson('PATCH', `/tickets/${ticketPrevio.id}/estado`, { estado: 'RESUELTO' }),
    'PATCH /tickets/:id/estado',
  );
  assertBaseNoDisponible(await requestJson('GET', `/tickets/${ticketPrevio.id}/historial`), 'GET /tickets/:id/historial');

  assert.equal(supportStartedAt(), startedAtBefore, 'support no debe haberse caído ni reiniciado');
});

test('al volver PostgreSQL, Support se recupera sin reiniciarse y sin estado a medias', async () => {
  compose('start', 'postgres');
  await waitFor(postgresIsReady, 60000, 'PostgreSQL disponible');
  await waitFor(supportIsReady, 60000, 'Support con /health/ready en ok');

  assert.equal(supportStartedAt(), startedAtBefore, 'la recuperación no debe requerir reiniciar el contenedor');

  // El ticket anterior a la caída quedó exactamente como estaba: el PATCH que
  // falló no cambió su estado ni su versión, y no dejó historial.
  const previo = await requestJson('GET', `/tickets/${ticketPrevio.id}`);
  assert.equal(previo.status, 200);
  assert.equal(previo.body.estado, ticketPrevio.estado);
  assert.equal(previo.body.version, ticketPrevio.version);
  const historialPrevio = await requestJson('GET', `/tickets/${ticketPrevio.id}/historial`);
  assert.equal(historialPrevio.body.length, 2);

  // Los POST que fallaron no dejaron tickets ni consumieron la clave.
  const duranteLaCaida = await requestJson('GET', `/tickets?tripId=${encodeURIComponent(tripDuranteLaCaida)}`);
  assert.equal(duranteLaCaida.status, 200);
  assert.deepEqual(duranteLaCaida.body, []);

  const reintento = await requestJson(
    'POST',
    '/tickets',
    { tripId: tripDuranteLaCaida, motivo: 'Durante la caída' },
    { 'Idempotency-Key': claveDuranteLaCaida },
  );
  assert.equal(reintento.status, 201, 'la clave no debe haber quedado consumida por el pedido fallido');

  const historialNuevo = await requestJson('GET', `/tickets/${reintento.body.id}/historial`);
  assert.equal(historialNuevo.body.length, 1);

  // Las operaciones vuelven a funcionar con normalidad.
  const resuelto = await requestJson('PATCH', `/tickets/${ticketPrevio.id}/estado`, {
    estado: 'RESUELTO',
    expectedVersion: ticketPrevio.version,
  });
  assert.equal(resuelto.status, 200);
  assert.equal(resuelto.body.version, ticketPrevio.version + 1);
});

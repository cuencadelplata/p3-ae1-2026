/**
 * E2E de resiliencia del servicio de comprobantes (AE2).
 *
 * Apaga de verdad cada backing service con "docker compose stop" y verifica
 * que el servicio siga corriendo, responda de forma controlada (503 con
 * Retry-After, nunca 500) y se recupere solo cuando la dependencia vuelve, sin
 * perder mensajes ni mandarlos a la DLQ:
 *
 *   Redis             -> la emision sigue; solo fallan los enlaces temporales.
 *   RabbitMQ          -> la API sigue; receipt.issued espera en la bandeja de
 *                        salida y se publica al volver.
 *   Autorizador fiscal-> timeout y circuit breaker; los pagos esperan en la cola
 *                        y se emiten al volver.
 *   PostgreSQL        -> /health/live sigue en 200; la API responde 503; los
 *                        pagos esperan y se emiten al volver. Tambien si la base
 *                        esta caida cuando el servicio arranca.
 *
 * Requiere el stack levantado (docker compose up -d en modulo-8) y el CLI de
 * Docker. Cada prueba vuelve a levantar lo que apago aunque falle.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const MODULE_DIR = fileURLToPath(new URL("../..", import.meta.url));
const RECEIPTS = process.env.RECEIPTS_URL ?? process.env.M8_URL ?? "http://localhost:3000";
const FISCAL = process.env.FISCAL_URL ?? "http://localhost:4010";
const RABBIT_API = process.env.RABBITMQ_API_URL ?? "http://localhost:15672/api";
const RABBIT_AUTH = `Basic ${Buffer.from(process.env.RABBITMQ_API_CREDENTIALS ?? "guest:guest").toString("base64")}`;
const POSTGRES_USER = process.env.POSTGRES_USER ?? "m8_admin";
const POSTGRES_DB = process.env.POSTGRES_DB ?? "m8";
const DLQ = "m8.receipts.payment-confirmed.dlq";
const RECEIPTS_AUTHORIZATION = process.env.RECEIPTS_AUTHORIZATION ?? "Bearer e2e-operator";

const run = `e2e-res-${Date.now()}`;

function compose(...args) {
  return execFileSync("docker", ["compose", ...args], {
    cwd: MODULE_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    // Delivery no se inicia en esta suite, pero Compose valida su configuración
    // al detener o reiniciar dependencias de Receipts.
    env: {
      ...process.env,
      M1_JWT_SECRET: process.env.M1_JWT_SECRET ?? "e2e-placeholder-not-for-production",
      M2_INTERNAL_API_KEY: process.env.M2_INTERNAL_API_KEY ?? "e2e-placeholder-not-for-production",
    },
  });
}

/** Consulta de solo lectura con el rol administrador, para inspeccionar la bandeja de salida. */
function sql(query) {
  return compose("exec", "-T", "postgres", "psql", "-U", POSTGRES_USER, "-d", POSTGRES_DB, "-tAc", query).trim();
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, { timeoutMs = 30000, what = "la condicion" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check().catch(() => null);
    if (value) {
      return value;
    }
    await pause(500);
  }
  throw new Error(`No se cumplio ${what} en ${timeoutMs} ms`);
}

/** Apaga un servicio durante fn y lo vuelve a levantar al terminar, falle o no. */
async function withStopped(service, fn) {
  compose("stop", service);
  try {
    await fn();
  } finally {
    compose("start", service);
  }
}

async function ready() {
  const response = await fetch(`${RECEIPTS}/health/ready`);
  const body = await response.json();
  const receipts = body.modules?.receipts ?? body;
  return { status: receipts.status === "unavailable" ? 503 : 200, body: receipts };
}

async function waitAllAvailable() {
  await waitFor(async () => (await ready()).body.status === "ok", { timeoutMs: 60000, what: "que todas las dependencias vuelvan" });
  await waitFor(
    async () => (await receiptFetch(`/api/v1/receipts/${run}-identity-check`)).status === 404,
    { timeoutMs: 15000, what: "la validacion de identidad de M1" },
  );
}

async function rabbit(method, path, body) {
  const response = await fetch(`${RABBIT_API}${path}`, {
    method,
    headers: { authorization: RABBIT_AUTH, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`RabbitMQ ${method} ${path} respondio ${response.status}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function publishPayment(tripId) {
  const event = paymentConfirmed(tripId);
  const result = await rabbit("POST", "/exchanges/%2F/mobility.events/publish", {
    routing_key: "payment.confirmed",
    properties: { message_id: event.messageId, content_type: "application/json", delivery_mode: 2 },
    payload: JSON.stringify(event),
    payload_encoding: "string",
  });
  assert.equal(result.routed, true);
  return event;
}

async function inDlq(messageId) {
  const messages = await rabbit("POST", `/queues/%2F/${encodeURIComponent(DLQ)}/get`, {
    count: 500,
    ackmode: "ack_requeue_true",
    encoding: "auto",
  });
  return messages.some((message) => message.properties.message_id === messageId);
}

function tripData(tripId) {
  return {
    fare: { currency: "ARS", baseFare: 1000, distanceAmount: 500, timeAmount: 0, surcharges: 0, discounts: 0, total: 1500 },
    customer: { id: "cli-res", fullName: "Cliente Resiliencia" },
    driver: { id: "cnd-res", fullName: "Conductor Resiliencia", vehicle: { type: "AUTO", plate: "RES000" } },
    trip: {
      origin: "Origen",
      destination: "Destino",
      startedAt: "2026-09-30T10:00:00.000Z",
      finishedAt: "2026-09-30T10:20:00.000Z",
      distanceKm: 5,
      durationMin: 20,
    },
    tripId,
  };
}

function paymentConfirmed(tripId) {
  return {
    messageId: randomUUID(),
    eventType: "PaymentConfirmed",
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId: tripId,
    producer: "m7-pagos",
    data: {
      ...tripData(tripId),
      paymentId: `pay-${tripId}`,
      confirmedAt: new Date().toISOString(),
      method: "TARJETA",
      status: "APROBADO",
    },
  };
}

function issue(tripId) {
  return fetch(`${RECEIPTS}/api/v1/receipts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...tripData(tripId), payment: { method: "TARJETA", status: "APROBADO" } }),
  });
}

function receiptFetch(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("authorization", RECEIPTS_AUTHORIZATION);
  return fetch(`${RECEIPTS}${path}`, { ...options, headers });
}

async function receiptExists(tripId) {
  return (await receiptFetch(`/api/v1/receipts/${tripId}`)).status === 200;
}

test("punto de partida: todas las dependencias disponibles y el circuito cerrado", async () => {
  await waitAllAvailable();
  const { body } = await ready();
  assert.equal(body.dependencies.fiscal.status, "available");
  assert.equal(body.circuits.fiscal, "closed");
});

test("sin Redis: se siguen emitiendo comprobantes y solo fallan los enlaces temporales", async () => {
  const tripId = `${run}-redis`;

  await withStopped("redis", async () => {
    const { status, body } = await ready();
    assert.equal(status, 200);
    assert.equal(body.status, "degraded");
    assert.equal(body.dependencies.redis.status, "unavailable");

    assert.equal((await issue(tripId)).status, 201);

    const reference = await fetch(`${RECEIPTS}/internal/receipts/${tripId}/delivery-reference`);
    assert.equal(reference.status, 503);
    assert.equal((await reference.json()).error.code, "DOWNLOAD_LINKS_UNAVAILABLE");
  });

  await waitAllAvailable();
  const reference = await fetch(`${RECEIPTS}/internal/receipts/${tripId}/delivery-reference`);
  assert.equal(reference.status, 200);
});

test("sin RabbitMQ: la API sigue y receipt.issued espera en la bandeja de salida hasta que vuelve", async () => {
  const tripId = `${run}-rabbit`;
  const pending = () => Number(sql(`SELECT count(*) FROM receipts.outbox_events WHERE correlation_id = '${tripId}' AND published_at IS NULL`));

  await withStopped("rabbitmq", async () => {
    await waitFor(async () => (await ready()).body.dependencies.rabbitmq.status === "unavailable", {
      what: "que el servicio detecte la caida de RabbitMQ",
    });
    const { status, body } = await ready();
    assert.equal(status, 200);
    assert.equal(body.status, "degraded");

    assert.equal((await issue(tripId)).status, 201);
    await pause(3000);
    assert.equal(pending(), 1, "el evento debe quedar pendiente mientras RabbitMQ esta caido");
  });

  await waitAllAvailable();
  await waitFor(async () => pending() === 0, { what: "la publicacion del evento pendiente" });

  // El consumidor tambien se reconecto: un pago nuevo se procesa.
  const paid = `${run}-rabbit-pago`;
  await waitFor(async () => (await publishPayment(paid)) && true, { what: "que RabbitMQ acepte publicaciones" });
  await waitFor(() => receiptExists(paid), { what: "la emision por evento tras la reconexion" });
});

test("autorizador fiscal lento: el timeout corta la espera en lugar de colgar la solicitud", async () => {
  await fetch(`${FISCAL}/admin/mode`, { method: "PUT", body: JSON.stringify({ mode: "slow" }) });
  try {
    const startedAt = Date.now();
    const response = await issue(`${run}-lento`);
    const elapsed = Date.now() - startedAt;

    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "FISCAL_SERVICE_UNAVAILABLE");
    assert.ok(response.headers.get("retry-after"));
    assert.ok(elapsed < 4500, `debe responder por timeout (~2 s) y no esperar los 5 s del autorizador; tardo ${elapsed} ms`);
  } finally {
    await fetch(`${FISCAL}/admin/mode`, { method: "PUT", body: JSON.stringify({ mode: "normal" }) });
  }

  // Un exito posterior cierra la cuenta de fallas.
  assert.equal((await issue(`${run}-lento-ok`)).status, 201);
});

test("autorizador fiscal caido: el circuito se abre, los pagos esperan sin ir a la DLQ y se emiten al volver", async () => {
  const paid = `${run}-fiscal-pago`;
  let event;

  await withStopped("fiscal-sandbox", async () => {
    event = await publishPayment(paid);

    // Las fallas (de la API y del consumidor) abren el circuito.
    const opened = await waitFor(
      async () => {
        const response = await issue(`${run}-fiscal-api`);
        assert.equal(response.status, 503, "sin autorizador la API debe responder 503, no 500");
        return (await ready()).body.circuits.fiscal === "open";
      },
      { what: "la apertura del circuito" },
    );
    assert.ok(opened);

    // Abierto: responde al instante, sin esperar el timeout, e indica cuando reintentar.
    const startedAt = Date.now();
    const response = await issue(`${run}-fiscal-api`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.match(body.error.message, /circuito abierto/);
    assert.ok(Number(response.headers.get("retry-after")) >= 1);
    assert.ok(Date.now() - startedAt < 1000, "con el circuito abierto no debe esperar al autorizador");

    const { status, body: health } = await ready();
    assert.equal(status, 200);
    assert.equal(health.status, "degraded");
    assert.equal(health.dependencies.fiscal.status, "unavailable");

    // Mas tiempo que el que agota los reintentos de un error comun (3 x 5 s):
    // el pago sigue esperando, no se emitio ni termino en la DLQ.
    await pause(20000);
    assert.equal(await receiptExists(paid), false);
    assert.equal(await inDlq(event.messageId), false);
  });

  await waitFor(() => receiptExists(paid), { timeoutMs: 60000, what: "la emision del pago que esperaba" });
  const receipt = (await (await receiptFetch(`/api/v1/receipts/${paid}`)).json()).data;
  assert.match(receipt.fiscal.authorizationCode, /^\d{14}$/);
  assert.equal(await inDlq(event.messageId), false);
  await waitFor(async () => (await ready()).body.circuits.fiscal === "closed", { what: "el cierre del circuito" });
});

test("sin PostgreSQL: el proceso sigue vivo, la API responde 503 y los pagos se emiten al volver", async () => {
  const issued = `${run}-pg-previo`;
  assert.equal((await issue(issued)).status, 201);
  const paid = `${run}-pg-pago`;
  let event;

  await withStopped("postgres", async () => {
    const live = await fetch(`${RECEIPTS}/health/live`);
    assert.equal(live.status, 200);

    const { status, body } = await ready();
    assert.equal(status, 503);
    assert.equal(body.dependencies.postgres.status, "unavailable");

    const response = await fetch(`${RECEIPTS}/internal/receipts/${issued}/delivery-reference`);
    assert.equal(response.status, 503, "una base caida no debe responder 500");
    assert.equal((await response.json()).error.code, "DATABASE_UNAVAILABLE");
    assert.ok(response.headers.get("retry-after"));

    event = await publishPayment(paid);
    await pause(8000);
  });

  await waitAllAvailable();
  await waitFor(() => receiptExists(paid), { timeoutMs: 60000, what: "la emision del pago que esperaba" });
  assert.equal(await inDlq(event.messageId), false);
  assert.equal(await receiptExists(issued), true);
});

test("PostgreSQL caido al arrancar: el servicio inicia igual y se recupera cuando la base vuelve", async () => {
  await withStopped("postgres", async () => {
    compose("restart", "m8-app");

    const live = await waitFor(async () => (await fetch(`${RECEIPTS}/health/live`)).ok, {
      what: "que el servicio arranque sin la base",
    });
    assert.ok(live);
    const { status, body } = await ready();
    assert.equal(status, 503);
    assert.equal(body.dependencies.postgres.status, "unavailable");
  });

  await waitAllAvailable();
  const paid = `${run}-arranque`;
  await publishPayment(paid);
  await waitFor(() => receiptExists(paid), { what: "la emision despues de recuperar la base" });
});

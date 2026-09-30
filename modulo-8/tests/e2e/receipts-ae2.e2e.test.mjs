/**
 * E2E del servicio de comprobantes contra los contenedores de Compose (AE2).
 *
 * Recorre los flujos asincronicos de punta a punta: publica en RabbitMQ como lo
 * haria M7, espera el comprobante por HTTP, escucha receipt.issued como lo haria
 * cualquier suscriptor e inspecciona la DLQ. Para RabbitMQ usa la API HTTP de
 * administracion, asi el workspace no necesita un cliente AMQP propio.
 *
 * El vencimiento del enlace se verifica solo si el stack se levanto con un TTL
 * corto (RECEIPT_LINK_TTL_SECONDS <= 30), como hace el pipeline de CI.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

const RECEIPTS = process.env.RECEIPTS_URL ?? "http://localhost:3008";
const RABBIT_API = process.env.RABBITMQ_API_URL ?? "http://localhost:15672/api";
const RABBIT_AUTH = `Basic ${Buffer.from(process.env.RABBITMQ_API_CREDENTIALS ?? "guest:guest").toString("base64")}`;
const EXCHANGE = "mobility.events";
const DLQ = "m8.receipts.payment-confirmed.dlq";
const MAX_TTL_TO_WAIT_SECONDS = 30;

const run = `e2e-ae2-${Date.now()}`;
const issuedQueue = `test.${run}.receipt-issued`;

async function rabbit(method, path, body) {
  const response = await fetch(`${RABBIT_API}${path}`, {
    method,
    headers: { authorization: RABBIT_AUTH, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(response.ok, `RabbitMQ ${method} ${path} respondio ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function publish(routingKey, content, messageId) {
  const result = await rabbit("POST", `/exchanges/%2F/${EXCHANGE}/publish`, {
    routing_key: routingKey,
    properties: { message_id: messageId, content_type: "application/json", delivery_mode: 2 },
    payload: typeof content === "string" ? content : JSON.stringify(content),
    payload_encoding: "string",
  });
  assert.equal(result.routed, true, "el mensaje debe llegar a al menos una cola");
}

/** Lee mensajes de una cola. requeue=true los deja en la cola (solo mirar). */
async function readQueue(queue, { requeue }) {
  const messages = await rabbit("POST", `/queues/%2F/${encodeURIComponent(queue)}/get`, {
    count: 200,
    ackmode: requeue ? "ack_requeue_true" : "ack_requeue_false",
    encoding: "auto",
  });
  return messages.map((message) => ({ properties: message.properties, payload: message.payload }));
}

async function waitFor(check, { timeoutMs = 15000, what = "la condicion" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No se cumplio ${what} en ${timeoutMs} ms`);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function paymentConfirmed(tripId) {
  return {
    messageId: randomUUID(),
    eventType: "PaymentConfirmed",
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId: tripId,
    producer: "m7-pagos",
    data: {
      tripId,
      paymentId: `pay-${tripId}`,
      confirmedAt: new Date().toISOString(),
      method: "TARJETA",
      status: "APROBADO",
      authorizationCode: "AUT-E2E",
      fare: { currency: "ARS", baseFare: 1000, distanceAmount: 500, timeAmount: 0, surcharges: 0, discounts: 0, total: 1500 },
      customer: { id: "cli-e2e", fullName: "Cliente Privado E2E", email: "privado.e2e@example.com" },
      driver: { id: "cnd-e2e", fullName: "Conductor E2E", vehicle: { type: "AUTO", plate: "E2E000" } },
      trip: {
        origin: "Origen E2E",
        destination: "Destino E2E",
        startedAt: "2026-09-30T10:00:00.000Z",
        finishedAt: "2026-09-30T10:20:00.000Z",
        distanceKm: 5,
        durationMin: 20,
      },
    },
  };
}

before(async () => {
  // Suscriptor de prueba de receipt.issued, ligado al exchange real.
  await rabbit("PUT", `/queues/%2F/${encodeURIComponent(issuedQueue)}`, { durable: false, auto_delete: false });
  await rabbit("POST", `/bindings/%2F/e/${EXCHANGE}/q/${encodeURIComponent(issuedQueue)}`, { routing_key: "receipt.issued" });
});

after(async () => {
  await fetch(`${RABBIT_API}/queues/%2F/${encodeURIComponent(issuedQueue)}`, {
    method: "DELETE",
    headers: { authorization: RABBIT_AUTH },
  });
});

test("/health/ready informa PostgreSQL, Redis, RabbitMQ y el autorizador fiscal disponibles", async () => {
  const response = await fetch(`${RECEIPTS}/health/ready`, { headers: { "X-Correlation-Id": run } });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-correlation-id"), run);
  assert.equal(body.status, "ok");
  for (const dependency of ["postgres", "redis", "rabbitmq", "fiscal"]) {
    assert.equal(body.dependencies[dependency].status, "available", `${dependency} debe estar disponible`);
  }
});

test("payment.confirmed emite el comprobante y un unico receipt.issued aunque llegue repetido", async () => {
  const tripId = `${run}-pago`;
  const event = paymentConfirmed(tripId);

  await publish("payment.confirmed", event, event.messageId);
  const receipt = await waitFor(
    async () => {
      const response = await fetch(`${RECEIPTS}/api/v1/receipts/${tripId}`);
      return response.ok ? (await response.json()).data : null;
    },
    { what: "la emision del comprobante" },
  );
  assert.equal(receipt.fare.total, 1500);

  // Reentrega del mismo mensaje y otro mensaje distinto para el mismo viaje.
  await publish("payment.confirmed", event, event.messageId);
  const other = paymentConfirmed(tripId);
  await publish("payment.confirmed", other, other.messageId);

  const issued = [];
  await waitFor(
    async () => {
      for (const message of await readQueue(issuedQueue, { requeue: false })) {
        const envelope = JSON.parse(message.payload);
        if (envelope.correlationId === tripId) {
          issued.push(envelope);
        }
      }
      return issued.length > 0;
    },
    { what: "la publicacion de receipt.issued" },
  );
  // Margen para que un segundo evento, si existiera, llegue a publicarse.
  await pause(4000);
  for (const message of await readQueue(issuedQueue, { requeue: false })) {
    const envelope = JSON.parse(message.payload);
    if (envelope.correlationId === tripId) {
      issued.push(envelope);
    }
  }

  assert.equal(issued.length, 1, "debe publicarse un unico receipt.issued por comprobante");
  assert.equal(issued[0].eventType, "ReceiptIssued");
  assert.equal(issued[0].data.receiptId, receipt.receiptId);
  const serialized = JSON.stringify(issued[0]);
  assert.ok(!serialized.includes("Cliente Privado") && !serialized.includes("privado.e2e"), "sin datos personales");

  const again = await (await fetch(`${RECEIPTS}/api/v1/receipts/${tripId}`)).json();
  assert.equal(again.data.receiptId, receipt.receiptId);
});

test("un mensaje invalido termina en la DLQ", async () => {
  const messageId = `${run}-invalido`;
  await publish("payment.confirmed", { esto: "no respeta el sobre" }, messageId);

  await waitFor(
    async () => (await readQueue(DLQ, { requeue: true })).some((message) => message.properties.message_id === messageId),
    { what: "la llegada del mensaje a la DLQ" },
  );
});

test("el enlace temporal descarga el PDF y deja de funcionar al vencer", async (t) => {
  const tripId = `${run}-enlace`;
  const event = paymentConfirmed(tripId);
  await publish("payment.confirmed", event, event.messageId);
  await waitFor(async () => (await fetch(`${RECEIPTS}/api/v1/receipts/${tripId}`)).ok, { what: "la emision" });

  const reference = await fetch(`${RECEIPTS}/internal/receipts/${tripId}/delivery-reference`);
  assert.equal(reference.status, 200);
  const { url, expiresAt } = (await reference.json()).data;
  assert.ok(!url.includes(tripId), "el enlace no debe revelar el tripId");

  const download = await fetch(url);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-type") ?? "", /^application\/pdf/);

  const remainingMs = Date.parse(expiresAt) - Date.now();
  if (remainingMs > MAX_TTL_TO_WAIT_SECONDS * 1000) {
    t.skip(`TTL de ${Math.round(remainingMs / 1000)} s: levantar el stack con RECEIPT_LINK_TTL_SECONDS<=${MAX_TTL_TO_WAIT_SECONDS} para verificar el vencimiento`);
    return;
  }

  await pause(remainingMs + 1500);
  const expired = await fetch(url);
  assert.equal(expired.status, 410);
  assert.equal((await expired.json()).error.code, "DOWNLOAD_LINK_EXPIRED");
});

test("los PDF ya no se publican como archivos estaticos", async () => {
  const response = await fetch(`${RECEIPTS}/files/receipts/${run}.pdf`);
  assert.equal(response.status, 404);
});

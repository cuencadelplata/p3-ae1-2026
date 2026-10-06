import assert from "node:assert/strict";
import test from "node:test";

const M8 = process.env.M8_URL ?? "http://localhost:3000";
const receiptsAuthorization = process.env.RECEIPTS_AUTHORIZATION ?? "Bearer e2e-operator";

const gateId = `m8-7w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body };
}

function postJson(url, body) {
  return requestJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("health de la aplicacion M8 integrada informa sus modulos", async () => {
  const { response, body } = await requestJson(`${M8}/health/ready`);
  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
  for (const moduleName of ["notifications", "qr", "receipts", "support", "delivery"]) {
    assert.equal(body.modules[moduleName].status, "ok", `${moduleName} debe estar disponible`);
  }
});

test("Notifications procesa una solicitud valida", async () => {
  const { response, body } = await postJson(`${M8}/notifications`, {
    tripId: `${gateId}-notification`,
    recipientId: `${gateId}-recipient`,
    eventType: "DRIVER_ASSIGNED",
    channels: ["PUSH"],
  });

  assert.equal(response.status, 201);
  assert.equal(body.status, "PROCESSED");
});

test("QR se crea, valida y no se puede reutilizar", async () => {
  const tripId = `${gateId}-qr`;
  const generated = await postJson(`${M8}/qr`, { tripId });
  assert.equal(generated.response.status, 201);
  assert.equal(typeof generated.body.token, "string");
  assert.match(generated.body.qrDataUrl, /^data:image\/png;base64,/);

  const validated = await postJson(`${M8}/qr/validate`, { tripId, token: generated.body.token });
  assert.equal(validated.response.status, 200);
  assert.deepEqual(validated.body, { valid: true });

  const reused = await postJson(`${M8}/qr/validate`, { tripId, token: generated.body.token });
  assert.equal(reused.response.status, 409);
  assert.equal(reused.body.error.code, "QR_ALREADY_USED");
});

test("Receipts emite, conserva idempotencia, consulta y descarga PDF", async () => {
  const tripId = `${gateId}-receipt`;
  const payload = {
    tripId,
    customer: { id: `${gateId}-customer`, fullName: "Cliente E2E", email: "e2e@example.com" },
    driver: {
      id: `${gateId}-driver`,
      fullName: "Conductor E2E",
      vehicle: { type: "AUTO", plate: "E2E123" },
    },
    trip: {
      origin: "Origen E2E",
      destination: "Destino E2E",
      startedAt: "2026-09-01T18:00:00.000Z",
      finishedAt: "2026-09-01T18:20:00.000Z",
      distanceKm: 5,
      durationMin: 20,
    },
    fare: { currency: "ARS", total: 2500 },
    payment: { method: "BILLETERA", status: "APROBADO" },
  };

  const issued = await postJson(`${M8}/api/v1/receipts`, payload);
  assert.equal(issued.response.status, 201);
  const receiptId = issued.body.data.receiptId;
  assert.equal(typeof receiptId, "string");

  const repeated = await postJson(`${M8}/api/v1/receipts`, payload);
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.body.data.receiptId, receiptId);

  const queried = await requestJson(`${M8}/api/v1/receipts/${tripId}`, {
    headers: { authorization: receiptsAuthorization },
  });
  assert.equal(queried.response.status, 200);
  assert.equal(queried.body.data.receiptId, receiptId);

  const pdf = await fetch(`${M8}/api/v1/receipts/${tripId}/pdf`, {
    headers: { authorization: receiptsAuthorization },
  });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get("content-type") ?? "", /^application\/pdf/);
});

test("Support crea un ticket", async () => {
  const { response, body } = await postJson(`${M8}/tickets`, {
    viajeId: `${gateId}-ticket`,
    motivo: "Validacion E2E global",
  });

  assert.equal(response.status, 201);
  assert.equal(body.viajeId, `${gateId}-ticket`);
});

test("Support publica un evento historico valido en RabbitMQ", async () => {
  const { response, body } = await postJson(`${M8}/events/publish`, {
    routingKey: "viaje.completado",
    payload: { viajeId: `${gateId}-rabbit`, importe: 2500 },
    count: 1,
  });

  assert.equal(response.status, 200);
  assert.ok(body.enviadosExitosamente >= 1);
});

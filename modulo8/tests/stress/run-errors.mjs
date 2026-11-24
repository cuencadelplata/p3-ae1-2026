#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const moduleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envPath = path.join(moduleDir, '.env');
const localEnv = existsSync(envPath) ? parse(readFileSync(envPath)) : {};
const get = (name) => process.env[name] || localEnv[name] || '';
const base = `http://127.0.0.1:${Number(get('M8_HOST_PORT') || 8000)}`;
const payments = `http://127.0.0.1:${Number(get('M7_HOST_PORT') || 4020)}`;
const qrKey = get('QR_INTERNAL_API_KEY');
if (!qrKey || qrKey.startsWith('replace-with-')) {
  console.error('Configurar QR_INTERNAL_API_KEY en modulo8/.env.');
  process.exit(2);
}
const results = [];
const jsonHeaders = { 'content-type': 'application/json' };
const request = (url, options = {}) => fetch(url, { signal: AbortSignal.timeout(10000), ...options });
async function expect(label, promise, expected) {
  const response = await promise;
  results.push({ label, expected, actual: response.status, passed: response.status === expected });
  assert.equal(response.status, expected, label);
  console.log(`${label}: HTTP ${response.status}`);
  return response;
}

const ready = await request(`${base}/health/ready`);
assert.equal(ready.status, 200, 'M8 debe estar listo antes de la prueba');
await expect('RF8.3 JSON mal formado', request(`${base}/api/v1/receipts`, {
  method: 'POST', headers: jsonHeaders, body: '{bad',
}), 400);
await expect('RF8.3 datos incompletos', request(`${base}/api/v1/receipts`, {
  method: 'POST', headers: jsonHeaders, body: JSON.stringify({ tripId: 'x' }),
}), 422);
await expect('RF8.3 sin identidad', request(`${base}/api/v1/receipts/trip-sin-login`), 401);
await expect('RF8.3 comprobante inexistente', request(`${base}/api/v1/receipts/no-existe-${randomUUID()}`, {
  headers: { authorization: 'Bearer e2e-operator' },
}), 404);

const tripId = `error-${randomUUID()}`;
const qrHeaders = { ...jsonHeaders, 'x-api-key': qrKey };
const generated = await expect('RF8.2 QR creado para prueba', request(`${base}/qr`, {
  method: 'POST', headers: qrHeaders, body: JSON.stringify({ tripId }),
}), 201);
const qr = await generated.json();
const validation = JSON.stringify({ tripId, token: qr.token });
await expect('RF8.2 primer uso del QR', request(`${base}/qr/validate`, {
  method: 'POST', headers: { ...qrHeaders, 'Idempotency-Key': randomUUID() }, body: validation,
}), 200);
await expect('RF8.2 segundo uso distinto', request(`${base}/qr/validate`, {
  method: 'POST', headers: { ...qrHeaders, 'Idempotency-Key': randomUUID() }, body: validation,
}), 409);

const originalModeResponse = await request(`${payments}/admin/mode`);
assert.equal(originalModeResponse.status, 200, 'El simulador de pagos del entorno aislado debe estar accesible');
const originalMode = (await originalModeResponse.json()).mode;
try {
  await expect('Pagos en modo caido', request(`${payments}/admin/mode`, {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ mode: 'down' }),
  }), 200);
  const receiptTripId = `error-pagos-${randomUUID()}`;
  const receipt = {
    tripId: receiptTripId,
    customer: { id: '91', fullName: 'Cliente Prueba', email: 'error@example.com' },
    driver: { id: '101', fullName: 'Conductor Prueba', vehicle: { type: 'AUTO', plate: 'ERR123' } },
    trip: { origin: 'Origen', destination: 'Destino', startedAt: '2026-09-01T18:00:00.000Z',
      finishedAt: '2026-09-01T18:20:00.000Z', distanceKm: 5, durationMin: 20 },
    fare: { currency: 'ARS', total: 2500 },
    payment: { method: 'BILLETERA', status: 'APROBADO' },
  };
  await expect('RF8.3 pagos de M7 caidos', request(`${base}/api/v1/receipts`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify(receipt),
  }), 503);
} finally {
  await request(`${payments}/admin/mode`, {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ mode: originalMode }),
  });
}

const metrics = await request(`${base}/metrics`);
assert.equal(metrics.status, 200);
const body = await metrics.text();
for (const code of [400, 401, 404, 409, 422, 503]) {
  assert.match(body, new RegExp(`http_requests_total\\{[^\\n]*status_code="${code}"`),
    `La metrica debe registrar HTTP ${code}`);
}
console.log(JSON.stringify({ status: 'ok', results, metricsCaptured: [400, 401, 404, 409, 422, 503] }));

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: fileURLToPath(new URL('../../.env.integracion', import.meta.url)), quiet: true });
const m6 = process.env.M6_TEST_URL || `http://localhost:${process.env.M6_VIAJES_HOST_PORT || 15000}`;
const m8 = process.env.M8_TEST_URL || `http://localhost:${process.env.M8_HOST_PORT || 18000}`;
const apiKey = process.env.QR_INTERNAL_API_KEY;
assert.ok(apiKey && apiKey.length >= 16, 'Configurar QR_INTERNAL_API_KEY compartida con M6');

async function request(base, route, method = 'GET', body, headers = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  return { status: response.status, data };
}

assert.equal((await request(m8, '/health/live')).status, 200);
const created = await request(m6, '/api/viajes', 'POST', {
  clienteId: '105', clientUserId: 105, rideRequestId: `m8-integration-${randomUUID()}`,
  origen: 'Origen prueba QR compartida', destino: 'Destino prueba QR compartida',
});
assert.equal(created.status, 201, JSON.stringify(created.data));
const tripId = created.data.id;
const assigned = await request(m6, `/api/viajes/${tripId}/asignar`, 'POST', {
  conductorId: '42', driverUserId: 42,
});
assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
const arrived = await request(m6, `/api/viajes/${tripId}/arribo`, 'PUT', {});
assert.equal(arrived.status, 200, JSON.stringify(arrived.data));
assert.ok(arrived.data.qr?.token, 'M6 debe recibir un QR generado por M8 real');
assert.match(arrived.data.qr.qrDataUrl, /^data:image\/png;base64,/);
const started = await request(m6, `/api/viajes/${tripId}/iniciar`, 'POST', { token: arrived.data.qr.token });
assert.equal(started.status, 200, JSON.stringify(started.data));
const trip = await request(m6, `/api/viajes/${tripId}`);
assert.equal(trip.data.estado, 'EN_CURSO');
const reused = await request(m8, '/qr/validate', 'POST', { tripId, token: arrived.data.qr.token }, {
  'x-api-key': apiKey, 'Idempotency-Key': randomUUID(),
});
assert.equal(reused.status, 409, 'Otra operación sobre el QR consumido debe obtener conflicto');
console.log(JSON.stringify({ status: 'ok', tripId, generationThroughM6: arrived.status,
  validationThroughM6: started.status, tripState: trip.data.estado, reuse: reused.status }));

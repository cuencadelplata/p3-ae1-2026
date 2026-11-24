// RF-8.2 en el stack común: QR generado y validado por M8 durante un viaje real de M6.
// Cliente y conductor son usuarios reales de M1; el conductor queda habilitado en el M3 real.
// Uso, desde modulo8:  node tests/e2e/shared-compose-qr.mjs
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: fileURLToPath(new URL('../../.env.integracion', import.meta.url)), quiet: true });
const m1 = process.env.M1_TEST_URL || `http://localhost:${process.env.M1_HOST_PORT || 10000}`;
const m3 = process.env.M3_CONDUCTOR_TEST_URL || 'http://localhost:5000';
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
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function m1User(rol) {
  const email = `qr.${rol.toLowerCase()}.${Date.now()}.${randomInt(1e6)}@m8-e2e.test`;
  const password = 'PasswordE2E123!';
  const registered = await request(m1, '/auth/registrar-usuario', 'POST', {
    nombre: rol, apellido: 'QR', dni: String(randomInt(20000000, 99999999)), telefono: '+543794000000', email, password, rol,
  });
  assert.ok([200, 201].includes(registered.status), `M1 registro ${rol}: ${JSON.stringify(registered.data)}`);
  const login = await request(m1, '/auth/iniciar-sesion', 'POST', { email, password });
  const identity = await request(m1, '/auth/validar-identidad-y-rol', 'GET', undefined, { authorization: `Bearer ${login.data.token}` });
  return { token: login.data.token, userId: Number(identity.data.userId) };
}

assert.equal((await request(m8, '/health/live')).status, 200);
const client = await m1User('CLIENTE');
const driver = await m1User('CONDUCTOR');
const profile = await request(m3, '/api/conductores', 'POST', { ciudad: 'Corrientes', tipovehiculo: 'auto' }, { authorization: `Bearer ${driver.token}` });
assert.equal(profile.status, 201, `M3 alta de conductor: ${JSON.stringify(profile.data)}`);
const enabled = await request(m3, `/api/conductores/${driver.userId}/habilitado`, 'PUT', { habilitado: 'activo' });
assert.equal(enabled.status, 200, `M3 habilitar conductor: ${JSON.stringify(enabled.data)}`);

const created = await request(m6, '/api/viajes', 'POST', {
  clienteId: String(client.userId), clientUserId: client.userId, rideRequestId: `m8-integration-${randomUUID()}`,
  origen: 'Av. 3 de Abril 1050, Corrientes', destino: 'Aeropuerto Internacional Corrientes',
});
assert.equal(created.status, 201, JSON.stringify(created.data));
const tripId = created.data.id;
const assigned = await request(m6, `/api/viajes/${tripId}/asignar`, 'POST', {
  conductorId: String(driver.userId), driverUserId: driver.userId,
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

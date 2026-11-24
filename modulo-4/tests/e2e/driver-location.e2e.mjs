import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import test from 'node:test';

const m1 = process.env.M1_E2E_URL || 'http://m1-identidad-acceso:3001';
const m4 = process.env.M4_E2E_URL || 'http://m4-api:3004/api/v1';
const m5 = process.env.M5_E2E_URL || 'http://m5-despacho:3005/api/v1';

async function request(url, expectedStatus, { method = 'GET', body, token, headers = {} } = {}) {
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });

  if (response.status !== expectedStatus) {
    const error = await response.json().catch(() => null);
    assert.equal(response.status, expectedStatus, `${method} ${url} (${error?.code || 'sin código'})`);
  }
  if (response.status === 204) return;
  return response.json();
}

async function loginNewUser(rol) {
  const credentials = {
    email: `m4-e2e-${randomUUID()}@example.com`,
    password: 'M4-Prueba-e2e!',
  };

  await request(`${m1}/auth/registrar-usuario`, 201, {
    method: 'POST',
    body: {
      ...credentials,
      nombre: rol === 'CONDUCTOR' ? 'Conductor' : 'Pasajero',
      apellido: 'Prueba',
      dni: String(randomInt(10_000_000, 100_000_000)),
      telefono: '3794222222',
      rol,
    },
  });

  const { token, usuario } = await request(`${m1}/auth/iniciar-sesion`, 200, {
    method: 'POST',
    body: credentials,
  });
  assert.ok(typeof token === 'string' && token.length > 0);
  assert.ok(Number.isInteger(usuario.id) && usuario.id > 0);
  assert.equal(usuario.rol, rol);
  return { token, usuario };
}

test('un pasajero solicita un viaje en M5 y encuentra al conductor que publicó su ubicación en M4', async (t) => {
  const { token, usuario } = await loginNewUser('CONDUCTOR');
  const passenger = await loginNewUser('CLIENTE');
  const locationUrl = `${m4}/drivers/${usuario.id}/location`;
  const location = {
    latitude: -27.4692,
    longitude: -58.8306,
    vehicleType: 'AUTO',
    available: true,
  };

  await request(locationUrl, 401, { method: 'PUT', body: location });
  const published = await request(locationUrl, 200, { method: 'PUT', body: location, token });
  t.after(() => request(locationUrl, 204, { method: 'DELETE', token }));
  assert.equal(published.driverId, usuario.id);

  const query = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    vehicleType: location.vehicleType,
    radiusKm: '1',
  });
  const { drivers } = await request(`${m4}/drivers/nearby?${query}`, 200);
  const candidate = drivers.find(({ driverId }) => driverId === usuario.id);
  assert.ok(candidate, 'la búsqueda debe devolver al conductor registrado en M1');
  assert.equal(candidate.vehicleType, location.vehicleType);
  assert.equal(candidate.available, true);

  const { entries } = await request(`${m4}/drivers/${usuario.id}/location-history?limit=1`, 200, { token });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].driverId, usuario.id);
  assert.equal(entries[0].updatedAt, published.updatedAt);

  const ride = await request(`${m5}/ride-requests`, 201, {
    method: 'POST',
    token: passenger.token,
    headers: { 'Idempotency-Key': randomUUID() },
    body: {
      origin: { latitude: location.latitude, longitude: location.longitude, address: 'Origen de prueba' },
      destination: { latitude: -27.4875, longitude: -58.7896, address: 'Destino de prueba' },
      vehicleType: location.vehicleType,
    },
  });
  assert.ok(ride.id);
  t.after(() => request(`${m5}/ride-requests/${ride.id}/cancel`, 200, {
    method: 'POST',
    token: passenger.token,
    headers: { 'X-User-Id': String(passenger.usuario.id) },
    body: { reason: 'Fin de la prueba de integración' },
  }));
  assert.equal(ride.status, 'SEARCHING');

  const { candidates } = await request(`${m5}/ride-requests/${ride.id}/candidates`, 200, {
    method: 'POST',
    token: passenger.token,
    headers: { 'X-User-Id': String(passenger.usuario.id) },
    body: { radiusKm: 1, maxCandidates: 5 },
  });
  const dispatchedCandidate = candidates.find(({ driverId }) => String(driverId) === String(usuario.id));
  assert.ok(dispatchedCandidate, 'M5 debe encontrar al mismo conductor publicado en M4');
  assert.equal(dispatchedCandidate.vehicleType, location.vehicleType);
});

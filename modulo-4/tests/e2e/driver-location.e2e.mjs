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
    signal: AbortSignal.timeout(15000),
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

async function waitForAvailability(driverId, expected) {
  const query = new URLSearchParams({
    latitude: '-27.4692', longitude: '-58.8306', vehicleType: 'AUTO', radiusKm: '1',
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { drivers } = await request(`${m4}/drivers/nearby?${query}`, 200);
    if (drivers.some((driver) => driver.driverId === driverId) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.fail(`La disponibilidad del conductor ${driverId} no cambió a ${expected}`);
}

test('M5 asigna el viaje a M6, M3 habilita al conductor y M4 procesa inicio y finalización con M8 y M7', {
  skip: !process.env.M6_E2E_URL || !process.env.M3_E2E_URL,
}, async (t) => {
  const m6 = process.env.M6_E2E_URL;
  const driver = await loginNewUser('CONDUCTOR');
  const passenger = await loginNewUser('CLIENTE');
  const locationUrl = `${m4}/drivers/${driver.usuario.id}/location`;
  const location = { latitude: -27.4692, longitude: -58.8306, vehicleType: 'AUTO', available: true };
  await request(locationUrl, 200, { method: 'PUT', token: driver.token, body: location });
  t.after(() => request(locationUrl, 204, { method: 'DELETE', token: driver.token }));

  const m3 = process.env.M3_E2E_URL;
  await request(`${m3}/api/conductores`, 201, {
    method: 'POST', token: driver.token,
    body: { usuarioID: String(driver.usuario.id), ciudad: 'Corrientes', tipovehiculo: 'auto' },
  });
  await request(`${m3}/api/conductores/${driver.usuario.id}/habilitado`, 200, {
    method: 'PUT', body: { habilitado: 'activo', motivo: 'Prueba E2E' },
  });
  const state = await request(`${m3}/api/conductor/${driver.usuario.id}/estado`, 200);
  assert.equal(state.habilitado, true, 'M3 debe reconocer al conductor como habilitado');

  const trip = await assignRide(driver, passenger, location, m6);
  const arrival = await request(`${m6}/api/viajes/${trip.id}/arribo`, 200, {
    method: 'PUT', body: {},
  });
  assert.ok(arrival.qr?.token, 'M8 debe emitir un token QR para el viaje');
  await request(locationUrl, 200, { method: 'PUT', token: driver.token, body: location });
  await request(`${m6}/api/viajes/${trip.id}/iniciar`, 200, {
    method: 'POST', body: { codigoVerificacion: arrival.qr.token },
  });
  await waitForAvailability(driver.usuario.id, false);

  await request(`${m6}/api/viajes/${trip.id}/finalizacion`, 200, {
    method: 'POST',
    body: { origen: { latitude: location.latitude, longitude: location.longitude },
      destino: { latitude: -27.4875, longitude: -58.7896 }, tipoVehiculo: 'auto',
      metodoPago: 'efectivo', horaFin: new Date().toISOString() },
  });
  await waitForAvailability(driver.usuario.id, true);
});

async function assignRide(driver, passenger, location, m6) {
  const ride = await request(`${m5}/ride-requests`, 201, {
    method: 'POST', token: passenger.token,
    headers: { 'Idempotency-Key': randomUUID() },
    body: {
      origin: { latitude: location.latitude, longitude: location.longitude, address: 'Corrientes centro' },
      destination: { latitude: -27.4875, longitude: -58.7896, address: 'Corrientes aeropuerto' },
      vehicleType: 'AUTO',
    },
  });
  const { offers } = await request(`${m5}/ride-requests/${ride.id}/offers`, 201, {
    method: 'POST', token: passenger.token,
    headers: { 'X-User-Id': String(passenger.usuario.id) },
    body: { driverIds: [String(driver.usuario.id)], ttlSeconds: 45 },
  });
  assert.equal(offers.length, 1);
  const accepted = await request(`${m5}/offers/${offers[0].id}/accept`, 200, {
    method: 'POST', token: driver.token,
    headers: { 'X-User-Id': String(driver.usuario.id) }, body: {},
  });
  assert.equal(accepted.requestStatus, 'ASSIGNED');
  const { viajes } = await request(`${m6}/api/viajes?clienteId=${passenger.usuario.id}`, 200);
  assert.equal(viajes.length, 1, 'M5 debe crear un único viaje para el pasajero nuevo');
  const [trip] = viajes;
  assert.equal(String(trip.conductorId), String(driver.usuario.id));
  return trip;
}

test('cancelar en M6 libera en M4 al conductor reservado mediante RabbitMQ', {
  skip: !process.env.M6_E2E_URL,
}, async (t) => {
  const m6 = process.env.M6_E2E_URL;
  const driver = await loginNewUser('CONDUCTOR');
  const passenger = await loginNewUser('CLIENTE');
  const locationUrl = `${m4}/drivers/${driver.usuario.id}/location`;
  const location = { latitude: -27.4692, longitude: -58.8306, vehicleType: 'AUTO', available: true };
  await request(locationUrl, 200, { method: 'PUT', token: driver.token, body: location });
  t.after(() => request(locationUrl, 204, { method: 'DELETE', token: driver.token }));
  const trip = await assignRide(driver, passenger, location, m6);

  // Preparación explícita de una reserva: no se inicia un viaje que M6 ya no permitiría cancelar.
  await request(`${m4}/drivers/${driver.usuario.id}/availability`, 200, {
    method: 'PATCH', token: driver.token, body: { available: false },
  });
  await waitForAvailability(driver.usuario.id, false);
  const reserved = await request(locationUrl, 200, { token: driver.token });
  assert.equal(reserved.available, false, 'el conductor debe tener ubicación vigente y estar reservado');

  const cancellation = { method: 'PATCH', body: { actor: 'cliente', motivo: 'Prueba E2E de cancelación' } };
  const cancelled = await request(`${m6}/api/viajes/${trip.id}/cancelacion`, 200, cancellation);
  assert.equal(cancelled.estado, 'CANCELADO');
  await waitForAvailability(driver.usuario.id, true);
  const released = await request(locationUrl, 200, { token: driver.token });
  assert.equal(released.available, true);
  assert.equal(released.latitude, location.latitude);
  assert.equal(released.longitude, location.longitude);

  // M6 rechaza repetir la transición; el conductor debe seguir disponible.
  await request(`${m6}/api/viajes/${trip.id}/cancelacion`, 400, cancellation);
  await waitForAvailability(driver.usuario.id, true);
});

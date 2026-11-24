// RF8.5 con M1, M6 y PostgreSQL reales. Requiere un operador de prueba de M1.
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: fileURLToPath(new URL('../../.env.integracion', import.meta.url)), quiet: true });

const m1 = process.env.M1_TEST_URL || `http://localhost:${process.env.M1_HOST_PORT || 10000}`;
const m2 = process.env.M2_TEST_URL || `http://localhost:${process.env.M2_API_PORT || 11000}`;
const m6 = process.env.M6_TEST_URL || `http://localhost:${process.env.M6_VIAJES_HOST_PORT || 15000}`;
const m8 = process.env.M8_TEST_URL || `http://localhost:${process.env.M8_HOST_PORT || 18000}`;
const operatorEmail = process.env.SUPPORT_E2E_OPERATOR_EMAIL;
const operatorPassword = process.env.SUPPORT_E2E_OPERATOR_PASSWORD;
const serviceKey = process.env.M2_SOPORTE_SECRET_KEY;
const verifyM2 = process.env.SUPPORT_E2E_VERIFY_M2 === 'true';
assert.ok(operatorEmail && operatorPassword, 'Configurar las credenciales de un operador de prueba de M1');
assert.ok(!verifyM2 || serviceKey, 'Configurar M2_SOPORTE_SECRET_KEY para verificar bloqueo y desbloqueo');

async function request(base, path, { method = 'GET', body, token, headers = {} } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function session(email, password, role) {
  const login = await request(m1, '/auth/iniciar-sesion', { method: 'POST', body: { email, password } });
  assert.equal(login.status, 200, `M1 login de ${role}`);
  const token = login.body.token;
  const identity = await request(m1, '/auth/validar-identidad-y-rol', { token });
  assert.equal(identity.status, 200, `M1 identidad de ${role}`);
  assert.equal(identity.body.valid, true);
  assert.equal(identity.body.role, role);
  assert.ok(Number.isSafeInteger(identity.body.userId) && identity.body.userId > 0);
  return { token, userId: identity.body.userId };
}

const operator = await session(operatorEmail, operatorPassword, 'OPERADOR');
const id = randomUUID();
const email = `rf85.${id}@m8-e2e.test`;
const password = `PasswordE2E!${randomUUID()}`;
const registered = await request(m1, '/auth/registrar-usuario', {
  method: 'POST',
  body: {
    nombre: 'Cliente', apellido: 'Soporte E2E', dni: String(randomInt(20000000, 99999999)),
    telefono: '+543794000000', email, password, rol: 'CLIENTE',
  },
});
assert.ok([200, 201].includes(registered.status), 'M1 debe registrar al cliente de prueba');
const customer = await session(email, password, 'CLIENTE');

async function confirmPenalty() {
  const legacyClientId = `cliente-m6-${id}`;
  const trip = await request(m6, '/api/viajes', {
    method: 'POST',
    body: {
      clienteId: legacyClientId, clientUserId: customer.userId, rideRequestId: `rf85-${randomUUID()}`,
      origen: 'Av. 3 de Abril 1050, Corrientes', destino: 'Aeropuerto Internacional Corrientes',
    },
  });
  assert.equal(trip.status, 201, 'M6 debe crear el viaje');
  const tripId = trip.body.id;
  const lookup = await request(m6, `/api/viajes/${tripId}`);
  assert.equal(lookup.status, 200, 'M6 debe exponer el viaje por ID');
  assert.equal(lookup.body.clienteId, legacyClientId);
  assert.equal(lookup.body.clientUserId, customer.userId, 'M6 debe devolver el ID numérico de M1');

  const ticket = await request(m8, '/tickets', {
    method: 'POST', token: customer.token, headers: { 'Idempotency-Key': randomUUID() },
    body: { tripId, motivo: 'Incidente de prueba para verificar la integración M6 y M8' },
  });
  assert.equal(ticket.status, 201, 'M8 debe crear el ticket');
  const ticketId = ticket.body.id;
  const resolved = await request(m8, `/tickets/${ticketId}/estado`, {
    method: 'PATCH', token: operator.token, body: { estado: 'RESUELTO', expectedVersion: ticket.body.version },
  });
  assert.equal(resolved.status, 200, 'El operador debe poder resolver el ticket');
  assert.equal(resolved.body.estado, 'RESUELTO');

  const confirm = (token) => request(m8, `/tickets/${ticketId}/penalizacion`, {
    method: 'POST', token, body: { motivo: 'Infracción confirmada por el operador de prueba' },
  });
  assert.equal((await confirm(customer.token)).status, 403, 'El cliente no puede confirmar penalizaciones');
  const penalty = await confirm(operator.token);
  assert.equal(penalty.status, 201, 'M8 debe confirmar la penalización usando el clientUserId de M6');
  assert.equal(penalty.body.tripId, tripId);
  assert.equal(penalty.body.ticketId, ticketId);
  const repeated = await confirm(operator.token);
  assert.equal(repeated.status, 200);
  assert.deepEqual(repeated.body, penalty.body);
  return penalty.body;
}

async function checkActivePenalties(expected) {
  const active = await request(m8, `/usuarios/${customer.userId}/penalizaciones`, {
    headers: { 'X-Secret-Key': serviceKey },
  });
  assert.equal(active.status, 200, 'M8 debe exponer las penalizaciones del userId de M1');
  assert.equal(active.body.userId, customer.userId);
  assert.equal(active.body.total, expected.length);
  for (const penalty of expected) {
    assert.deepEqual(active.body.penalizaciones.find((row) => row.ticketId === penalty.ticketId), penalty);
  }
}

if (verifyM2) {
  const profile = await request(m2, '/v1/customers', {
    method: 'POST', token: customer.token,
    body: { preferences: { preferredVehicleType: 'auto', notificationChannel: 'push' } },
  });
  assert.equal(profile.status, 201, 'M2 debe crear el perfil de prueba');
  const customerId = profile.body.customerId;
  assert.ok(customerId, 'M2 debe devolver el ID del perfil');
  const statePath = `/v1/customers/${customerId}/status`;
  const getState = () => request(m2, statePath, { token: customer.token });
  const penalties = [];
  const states = [];
  for (const expected of ['ACTIVO', 'BLOQUEADO_TEMPORAL', 'BLOQUEADO_PERMANENTE']) {
    penalties.push(await confirmPenalty());
    const state = await getState();
    assert.equal(state.status, 200, 'M2 debe responder el estado de cuenta');
    assert.equal(state.body.status, expected, `M2 debe aplicar ${expected} con ${penalties.length} penalizaciones`);
    states.push(state.body.status);
  }

  const { ticketId } = penalties.at(-1);
  const unlock = (token) => request(m8, `/tickets/${ticketId}/desbloqueo`, {
    method: 'POST', token, body: { motivo: 'Revisión manual de las penalizaciones de prueba' },
  });
  assert.equal((await unlock(customer.token)).status, 403, 'Solo un operador puede desbloquear la cuenta');
  const reviewed = await unlock(operator.token);
  assert.equal(reviewed.status, 200, 'M8 debe confirmar el desbloqueo en M2');
  assert.deepEqual(reviewed.body, { userId: customer.userId, status: 'ACTIVO' });
  assert.equal((await unlock(operator.token)).status, 200, 'Reintentar el desbloqueo conserva la cuenta activa');
  const after = await getState();
  assert.equal(after.status, 200);
  assert.equal(after.body.status, 'ACTIVO', 'Las penalizaciones anteriores a la revisión no vuelven a bloquear');
  assert.ok(after.body.reviewedAt, 'M2 debe auditar la fecha de la revisión');
  assert.ok(after.body.reason.includes(`operador ${operator.userId}, ticket ${ticketId}`));
  await checkActivePenalties(penalties);

  console.log(JSON.stringify({
    status: 'ok', clientUserId: customer.userId, operatorUserId: operator.userId, ticketId,
    states, unlock: reviewed.status, stateAfterReview: after.body.status, penaltiesPreserved: penalties.length,
  }));
} else {
  const penalty = await confirmPenalty();
  if (serviceKey) await checkActivePenalties([penalty]);
  console.log(JSON.stringify({
    status: 'ok', tripId: penalty.tripId, clientUserId: customer.userId, operatorUserId: operator.userId,
    ticketId: penalty.ticketId, confirmation: 201, repeat: 200, activeListVerified: Boolean(serviceKey),
  }));
}

// RF-8.3 en el Compose común: comprobante emitido a partir de un viaje real.
//
// Recorrido (todos los módulos reales, sin simuladores de M1, M3, M6 ni M7):
//   M1  registra cliente y conductor e inicia sesión de ambos.
//   M3  da de alta al conductor y su vehículo activo.
//   M6  crea el viaje, asigna, registra el arribo (QR de M8), inicia y finaliza
//       (M6 consulta a M4 la distancia y a M7 la tarifa y el pago).
//   M6 → RabbitMQ: TripCompleted (mobility.events, trip.completed).
//   M8  consume el evento en m8.receipts.trip-completed, consulta M6, M3 y M7,
//       autoriza con el fiscal simulado y guarda el PDF.
//   El cliente consulta su comprobante con su token de M1 y lo descarga.
//
// Requisitos: stack común levantado (ver INTEGRACION_COMPOSE.md) con M7 real o
// con el simulador de su contrato (perfil m7-sandbox).
// Uso, desde modulo8:  node tests/e2e/shared-compose-receipt.mjs
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: fileURLToPath(new URL('../../.env.integracion', import.meta.url)), quiet: true });

const url = (name, port) => (process.env[name] || `http://localhost:${port}`).replace(/\/+$/, '');
const m1 = url('M1_TEST_URL', process.env.M1_HOST_PORT || 10000);
const m3Conductor = url('M3_CONDUCTOR_TEST_URL', 5000);
const m3Vehicles = url('M3_VEHICLES_TEST_URL', 8083);
const m6 = url('M6_TEST_URL', process.env.M6_VIAJES_HOST_PORT || 15000);
const m8 = url('M8_TEST_URL', process.env.M8_HOST_PORT || 18000);
const receiptTimeoutMs = Number(process.env.RECEIPT_E2E_TIMEOUT_MS || 60000);

// Medio de pago del viaje. Con tarjeta, M6 reenvía a M7 el token que generaría la
// app del cliente con el checkout de Mercado Pago.
const paymentMethod = process.env.RECEIPT_E2E_METODO_PAGO || 'tarjeta';
const cardPayment = {
  token: process.env.RECEIPT_E2E_CARD_TOKEN || 'card-token-e2e',
  paymentMethodId: process.env.RECEIPT_E2E_PAYMENT_METHOD_ID || 'visa',
  email: 'cliente.e2e@example.com',
};

async function request(base, route, { method = 'GET', body, token, headers = {} } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: response.status, data };
}

const show = (result) => JSON.stringify(result.data);

async function m1Session(rol, nombre) {
  const email = `rf83.${rol.toLowerCase()}.${Date.now()}.${randomInt(1e6)}@m8-e2e.test`;
  const password = 'PasswordE2E123!';
  const registered = await request(m1, '/auth/registrar-usuario', {
    method: 'POST',
    body: {
      nombre, apellido: 'E2E', dni: String(randomInt(20000000, 99999999)), telefono: '+543794000000',
      email, password, rol,
    },
  });
  assert.ok([200, 201].includes(registered.status), `M1 registro ${rol}: ${show(registered)}`);
  const login = await request(m1, '/auth/iniciar-sesion', { method: 'POST', body: { email, password } });
  assert.equal(login.status, 200, `M1 login ${rol}: ${show(login)}`);
  const identity = await request(m1, '/auth/validar-identidad-y-rol', { token: login.data.token });
  assert.equal(identity.status, 200, `M1 validar ${rol}: ${show(identity)}`);
  return { token: login.data.token, userId: Number(identity.data.userId) };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 1. Identidades reales en M1
const customer = await m1Session('CLIENTE', 'Cliente');
const driver = await m1Session('CONDUCTOR', 'Conductor');

// 1b. Perfil del cliente en M2 (avisos por push) y su dispositivo en M8 (RF-8.7):
// así los avisos del viaje recorren la entrega real (preferencias de M2 + push).
const m2 = url('M2_TEST_URL', 11000);
const profile = await request(m2, '/v1/customers', {
  method: 'POST', token: customer.token,
  body: { preferences: { preferredVehicleType: 'auto', notificationChannel: 'push' } },
});
assert.equal(profile.status, 201, `M2 alta de perfil: ${show(profile)}`);
const device = await request(m8, '/devices/tokens', {
  method: 'POST', token: customer.token, body: { token: `device-e2e-${randomUUID()}`, platform: 'ANDROID' },
});
assert.equal(device.status, 201, `M8 registro de dispositivo: ${show(device)}`);

// 2. Conductor y vehículo en M3
const driverProfile = await request(m3Conductor, '/api/conductores', {
  method: 'POST', token: driver.token, body: { ciudad: 'Corrientes', tipovehiculo: 'auto' },
});
assert.equal(driverProfile.status, 201, `M3 alta de conductor: ${show(driverProfile)}`);
// M6 solo registra el arribo de un conductor habilitado en M3 (lo hace un operador).
const enabled = await request(m3Conductor, `/api/conductores/${driver.userId}/habilitado`, {
  method: 'PUT', body: { habilitado: 'activo' },
});
assert.equal(enabled.status, 200, `M3 habilitar conductor: ${show(enabled)}`);
const plate = `AB${randomInt(100, 999)}CD`;
const vehicle = await request(m3Vehicles, `/api/v1/drivers/${driver.userId}/vehicles`, {
  method: 'POST',
  headers: { 'Idempotency-Key': randomUUID() },
  body: { patente: plate, marca: 'Toyota', modelo: 'Etios', anio: 2022, tipoServicio: 'AUTO' },
});
assert.equal(vehicle.status, 201, `M3 alta de vehículo: ${show(vehicle)}`);
const activated = await request(m3Vehicles, `/api/v1/drivers/${driver.userId}/vehicles/${vehicle.data.id}/activar`, {
  method: 'PATCH',
});
assert.equal(activated.status, 200, `M3 activar vehículo: ${show(activated)}`);

// 3. Viaje completo en M6
const created = await request(m6, '/api/viajes', {
  method: 'POST',
  body: {
    clienteId: String(customer.userId), clientUserId: customer.userId, rideRequestId: `rf83-e2e-${randomUUID()}`,
    origen: 'Av. 3 de Abril 1050, Corrientes', destino: 'Aeropuerto Internacional Corrientes',
  },
});
assert.equal(created.status, 201, `M6 crear viaje: ${show(created)}`);
const tripId = created.data.id;

const assigned = await request(m6, `/api/viajes/${tripId}/asignar`, {
  method: 'POST', body: { conductorId: String(driver.userId), driverUserId: driver.userId },
});
assert.equal(assigned.status, 200, `M6 asignar: ${show(assigned)}`);
const arrived = await request(m6, `/api/viajes/${tripId}/arribo`, { method: 'PUT', body: {} });
assert.equal(arrived.status, 200, `M6 arribo: ${show(arrived)}`);
assert.ok(arrived.data.qr?.token, 'M6 debe recibir el QR generado por M8');
const started = await request(m6, `/api/viajes/${tripId}/iniciar`, { method: 'POST', body: { token: arrived.data.qr.token } });
assert.equal(started.status, 200, `M6 iniciar: ${show(started)}`);

const finished = await request(m6, `/api/viajes/${tripId}/finalizacion`, {
  method: 'POST',
  body: {
    origen: { latitude: -27.4692, longitude: -58.8306, address: 'Av. 3 de Abril 1050, Corrientes' },
    destino: { latitude: -27.4459, longitude: -58.7619, address: 'Aeropuerto Internacional Corrientes' },
    tipoVehiculo: 'auto',
    horaFin: new Date().toISOString(),
    metodoPago: paymentMethod,
    ...(paymentMethod === 'tarjeta' ? { pago: cardPayment } : {}),
  },
});
assert.equal(finished.status, 200, `M6 finalizar: ${show(finished)}`);

// 4. Comprobante emitido por M8 a partir de TripCompleted
let receipt;
const deadline = Date.now() + receiptTimeoutMs;
while (Date.now() < deadline) {
  receipt = await request(m8, `/api/v1/receipts/${tripId}`, { token: customer.token });
  if (receipt.status === 200) break;
  assert.equal(receipt.status, 404, `M8 consulta del comprobante: ${show(receipt)}`);
  await sleep(1500);
}
assert.equal(receipt?.status, 200, `M8 no emitió el comprobante del viaje ${tripId} en ${receiptTimeoutMs} ms`);
const data = receipt.data.data ?? receipt.data;
assert.equal(data.tripId, tripId);
assert.equal(data.customer.id, String(customer.userId));
assert.equal(data.driver.vehicle.plate, plate);
assert.equal(data.fare.total, finished.data.viaje.total);
assert.equal(data.payment.method, paymentMethod.toUpperCase());
// Tarjeta: M7 la autoriza. Efectivo y transferencia se cobran fuera de la pasarela y quedan pendientes.
assert.equal(data.payment.status, paymentMethod === 'tarjeta' ? 'APROBADO' : 'PENDIENTE');
assert.ok(data.fiscal?.authorizationCode, 'el comprobante debe tener autorización fiscal');

// Otro usuario no puede ver el comprobante (RF-8.4 con M1 real)
const ajeno = await m1Session('CLIENTE', 'Ajeno');
const forbidden = await request(m8, `/api/v1/receipts/${tripId}`, { token: ajeno.token });
assert.equal(forbidden.status, 403, `Un cliente ajeno no debe ver el comprobante: ${show(forbidden)}`);

// Enlace temporal (Redis) y descarga del PDF
const reference = await request(m8, `/internal/receipts/${tripId}/delivery-reference`, { token: customer.token });
assert.equal(reference.status, 200, `M8 delivery-reference: ${show(reference)}`);
const link = (reference.data.data ?? reference.data).url;
const pdf = await fetch(link, { signal: AbortSignal.timeout(15000) });
assert.equal(pdf.status, 200);
assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');

// RF-8.4: reenvío del mismo comprobante. Sin email del cliente (M1 no lo
// comparte) hay que indicar el destino; el reenvío da un enlace nuevo al mismo PDF.
const noDestination = await request(m8, `/api/v1/receipts/${tripId}/resend`, {
  method: 'POST', token: customer.token, body: { channel: 'EMAIL' },
});
assert.equal(noDestination.data?.error?.code, 'DELIVERY_DESTINATION_REQUIRED', `reenvío sin destino: ${show(noDestination)}`);
const resent = await request(m8, `/api/v1/receipts/${tripId}/resend`, {
  method: 'POST', token: customer.token, body: { channel: 'EMAIL', destination: 'cliente.e2e@example.com' },
});
assert.equal(resent.status, 202, `M8 reenvío: ${show(resent)}`);
assert.equal(resent.data.data.receiptId, data.receiptId, 'el reenvío no emite otro comprobante');
const resentPdf = await fetch(resent.data.data.lastDelivery.url, { signal: AbortSignal.timeout(15000) });
assert.equal(resentPdf.status, 200);

// Repetir la finalización no emite otro comprobante (idempotencia en M6 y en M8)
const repeated = await request(m6, `/api/viajes/${tripId}/finalizacion`, {
  method: 'POST',
  body: {
    origen: { latitude: -27.4692, longitude: -58.8306 }, destino: { latitude: -27.4459, longitude: -58.7619 },
    tipoVehiculo: 'auto', horaFin: new Date().toISOString(), metodoPago: paymentMethod,
    ...(paymentMethod === 'tarjeta' ? { pago: cardPayment } : {}),
  },
});
assert.equal(repeated.data?.idempotente, true, `M6 debe reconocer la finalización repetida: ${show(repeated)}`);
const again = await request(m8, `/api/v1/receipts/${tripId}`, { token: customer.token });
assert.equal((again.data.data ?? again.data).receiptId, data.receiptId);

console.log(JSON.stringify({
  status: 'ok', tripId, customerUserId: customer.userId, driverUserId: driver.userId,
  receiptNumber: data.receiptNumber, total: data.fare.total, payment: data.payment, plate,
}));

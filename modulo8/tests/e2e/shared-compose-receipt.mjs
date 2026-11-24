// RF-8.3 en el Compose común: comprobante emitido a partir de un viaje real.
//
// Recorrido (todos los módulos reales, sin simuladores de M1, M3, M6 ni M7):
//   M1  registra cliente y conductor e inicia sesión de ambos.
//   M3  da de alta al conductor y su vehículo activo.
//   M6  crea el viaje, asigna, registra el arribo (QR de M8) e inicia.
//   M7  registra y autoriza el pago antes de que M6 finalice el viaje.
//   M6 → RabbitMQ: TripCompleted (mobility.events, trip.completed).
//   M8  consume el evento en m8.receipts.trip-completed, consulta M6, M3 y M7
//       y guarda el PDF.
//   El cliente consulta su comprobante con su token de M1 y lo descarga.
//
// Requisitos: stack común levantado con M7 real (ver INTEGRACION_COMPOSE.md).
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
const m4 = url('M4_TEST_URL', process.env.M4_API_PORT || 3004);
const m6 = url('M6_TEST_URL', process.env.M6_VIAJES_HOST_PORT || 15000);
const m7 = url('M7_TEST_URL', 17000);
const m8 = url('M8_TEST_URL', process.env.M8_HOST_PORT || 18000);
const receiptTimeoutMs = Number(process.env.RECEIPT_E2E_TIMEOUT_MS || 60000);

const paymentMethod = process.env.RECEIPT_E2E_METODO_PAGO || 'tarjeta';
const m7Env = dotenv.config({ path: fileURLToPath(new URL('../../../modulo7/.env', import.meta.url)), processEnv: {}, quiet: true }).parsed ?? {};
const m7ApiKey = process.env.M7_API_KEY || m7Env.M7_API_KEY;
assert.ok(m7ApiKey, 'Configurar M7_API_KEY para registrar y autorizar el pago de prueba');
assert.ok(['tarjeta', 'efectivo', 'transferencia'].includes(paymentMethod), 'Medio de pago de prueba inválido');
const paymentHeaders = { 'x-api-key': m7ApiKey };

async function cardPayment() {
  let token = process.env.RECEIPT_E2E_CARD_TOKEN;
  if (!token) {
    const accessToken = process.env.MP_ACCESS_TOKEN || m7Env.MP_ACCESS_TOKEN;
    assert.ok(accessToken?.startsWith('TEST-'), 'Usar MP_ACCESS_TOKEN de prueba para tokenizar la tarjeta de demostración');
    const response = await fetch('https://api.mercadopago.com/v1/card_tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        card_number: '4509953566233704', security_code: '123', expiration_month: 11, expiration_year: 2030,
        cardholder: { name: 'APRO', identification: { type: 'DNI', number: '12345678' } },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => ({}));
    assert.ok(response.ok && body.id, `Mercado Pago no tokenizó la tarjeta de prueba (HTTP ${response.status})`);
    token = body.id;
  }
  return { token, paymentMethodId: process.env.RECEIPT_E2E_PAYMENT_METHOD_ID || 'visa', email: 'cliente.e2e@example.com' };
}

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

// 1b. Perfil del cliente en M2 (avisos por push): los avisos del viaje recorren
// la entrega real con sus preferencias. El push llega a un navegador suscripto
// desde http://localhost:18000/push; sin navegador, la entrega queda registrada
// como FAILED_NO_DEVICE_TOKEN.
const m2 = url('M2_TEST_URL', 11000);
const profile = await request(m2, '/v1/customers', {
  method: 'POST', token: customer.token,
  body: { preferences: { preferredVehicleType: 'auto', notificationChannel: 'push' } },
});
assert.equal(profile.status, 201, `M2 alta de perfil: ${show(profile)}`);

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
const arrived = await request(m6, `/api/viajes/${tripId}/arribo`, { method: 'PUT', token: customer.token, body: {} });
assert.equal(arrived.status, 200, `M6 arribo: ${show(arrived)}`);
assert.ok(arrived.data.qr?.token, 'M6 debe recibir el QR generado por M8');
const started = await request(m6, `/api/viajes/${tripId}/iniciar`, { method: 'POST', token: driver.token, body: { token: arrived.data.qr.token } });
assert.equal(started.status, 200, `M6 iniciar: ${show(started)}`);

const destinationPath = '/api/viajes/' + tripId + '/destino';
const beforeDestination = await request(m6, '/api/viajes/' + tripId + '/finalizacion', {
  method: 'POST', token: customer.token, body: {},
});
assert.equal(beforeDestination.status, 409, 'M6 debe bloquear el pago antes de la llegada');
assert.equal((await request(m6, destinationPath, { method: 'POST', token: customer.token, body: {} })).status, 403);
const destinationReached = await request(m6, destinationPath, { method: 'POST', token: driver.token, body: {} });
assert.equal(destinationReached.status, 200);
assert.ok(Number.isFinite(Date.parse(destinationReached.data.destinoConfirmadoAt)));
// Fijar la hora de cierre al iniciar el viaje: este recorrido dura un minuto
// de tarifa. La autorización y los reintentos reutilizan ese mismo cierre.
const finalizationBody = {
  origen: { latitude: -27.4692, longitude: -58.8306, address: 'Av. 3 de Abril 1050, Corrientes' },
  destino: { latitude: -27.4459, longitude: -58.7619, address: 'Aeropuerto Internacional Corrientes' },
  tipoVehiculo: 'auto',
  horaFin: new Date().toISOString(),
  metodoPago: paymentMethod,
};
const { origen, destino, tipoVehiculo } = finalizationBody;
const estimate = await request(m4, '/api/v1/estimate', {
  method: 'POST', body: {
    origin: { latitude: origen.latitude, longitude: origen.longitude },
    destination: { latitude: destino.latitude, longitude: destino.longitude },
  },
});
assert.equal(estimate.status, 200, `M4 estimar distancia: ${show(estimate)}`);
const fare = await request(m7, '/tarifa/estimacion', {
  method: 'POST', body: {
    origen: { lat: origen.latitude, lng: origen.longitude, direccion: origen.address },
    destino: { lat: destino.latitude, lng: destino.longitude, direccion: destino.address },
    distanciaKm: estimate.data.distanceKm,
    tiempoEstimadoMin: 1,
    vehicleType: tipoVehiculo,
  },
});
assert.equal(fare.status, 200, `M7 estimar tarifa: ${show(fare)}`);
const total = fare.data.estimatedFare;
const currency = fare.data.currency || 'ARS';
assert.ok(Number.isFinite(total) && total > 0, 'M7 debe informar el importe de prueba');

const paymentPath = `/metodo-pago/${tripId}`;
const payment = await request(m7, '/metodo-pago', {
  method: 'POST', headers: paymentHeaders,
  body: { clienteId: String(customer.userId), viajeId: tripId, tipo: paymentMethod },
});
assert.equal(payment.status, 201, `M7 registrar pago: ${show(payment)}`);
assert.equal(payment.data.estado, 'pendiente');

const finalize = () => request(m6, `/api/viajes/${tripId}/finalizacion`, {
  method: 'POST', body: finalizationBody,
});
const pending = await finalize();
assert.equal(pending.status, 402, `M6 debe rechazar el pago pendiente: ${show(pending)}`);

const authorized = await request(m7, `${paymentPath}/autorizar`, {
  method: 'POST', headers: paymentHeaders, body: {
    idOrden: `ORD-${tripId}`, total, moneda: currency,
    ...(paymentMethod === 'tarjeta' ? await cardPayment() : {}),
  },
});
assert.equal(authorized.status, 200, `M7 autorizar pago: ${show(authorized)}`);
assert.equal(authorized.data.estado, 'autorizado');
assert.equal(authorized.data.tipo, paymentMethod);
assert.equal(authorized.data.total, total);

const finished = await finalize();
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
assert.equal(data.fare.total, total);
assert.equal(data.payment.method, paymentMethod.toUpperCase());
assert.equal(data.payment.status, 'APROBADO');
assert.equal(data.fiscal, undefined, 'el comprobante ya no pasa por un autorizador fiscal');

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
const repeated = await finalize();
assert.equal(repeated.data?.idempotente, true, `M6 debe reconocer la finalización repetida: ${show(repeated)}`);
const again = await request(m8, `/api/v1/receipts/${tripId}`, { token: customer.token });
assert.equal((again.data.data ?? again.data).receiptId, data.receiptId);

console.log(JSON.stringify({
  status: 'ok', tripId, customerUserId: customer.userId, driverUserId: driver.userId,
  pendingBeforeAuthorization: pending.status, m7Authorization: authorized.status,
  finalization: finished.status, receiptNumber: data.receiptNumber, total: data.fare.total, payment: data.payment, plate,
}));

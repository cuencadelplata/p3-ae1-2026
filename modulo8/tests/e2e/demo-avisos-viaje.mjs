// Demo de avisos de viaje (RF-8.1 -> RF-8.6 -> RF-8.7) en el stack común.
// El cliente debe tener perfil push en M2 y el navegador activado en http://localhost:18000/push.
// Hace un viaje real en M6 (llegada del conductor e inicio con el QR de M8) y otro que el
// conductor cancela: el navegador del cliente recibe tres notificaciones.
// Uso, desde modulo8:  node tests/e2e/demo-avisos-viaje.mjs
// Cliente: DEMO_CLIENTE_EMAIL y DEMO_CLIENTE_PASSWORD (por defecto, el cliente de demo local).
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const m1 = 'http://localhost:10000', m3c = 'http://localhost:5000', m3v = 'http://localhost:8083', m6 = 'http://localhost:15000';
const cliente = {
  email: process.env.DEMO_CLIENTE_EMAIL || 'cliente.demo@movilidad.test',
  password: process.env.DEMO_CLIENTE_PASSWORD || 'DemoM8push2026!',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(base, route, { method = 'GET', body, token, headers = {} } = {}) {
  const r = await fetch(`${base}${route}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  const t = await r.text();
  let data; try { data = t ? JSON.parse(t) : null; } catch { data = { raw: t }; }
  return { status: r.status, data };
}
const show = (x) => JSON.stringify(x.data);
async function login(email, password) {
  const l = await request(m1, '/auth/iniciar-sesion', { method: 'POST', body: { email, password } });
  assert.equal(l.status, 200, show(l));
  const id = await request(m1, '/auth/validar-identidad-y-rol', { token: l.data.token });
  return { token: l.data.token, userId: Number(id.data.userId) };
}

const client = await login(cliente.email, cliente.password);
// Conductor nuevo, habilitado en M3 y con vehículo activo.
const demail = `conductor.demo.${Date.now()}@movilidad.test`, dpass = 'DemoConductor2026!';
const reg = await request(m1, '/auth/registrar-usuario', { method: 'POST', body: { nombre: 'Conductor', apellido: 'Demo', dni: String(randomInt(20000000, 99999999)), telefono: '+543794000002', email: demail, password: dpass, rol: 'CONDUCTOR' } });
assert.ok([200, 201].includes(reg.status), show(reg));
const driver = await login(demail, dpass);
assert.equal((await request(m3c, '/api/conductores', { method: 'POST', token: driver.token, body: { ciudad: 'Corrientes', tipovehiculo: 'auto' } })).status, 201);
assert.equal((await request(m3c, `/api/conductores/${driver.userId}/habilitado`, { method: 'PUT', body: { habilitado: 'activo' } })).status, 200);
const vehicle = await request(m3v, `/api/v1/drivers/${driver.userId}/vehicles`, { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: { patente: `AD${randomInt(100, 999)}MO`, marca: 'Toyota', modelo: 'Etios', anio: 2022, tipoServicio: 'AUTO' } });
assert.equal(vehicle.status, 201, show(vehicle));
await request(m3v, `/api/v1/drivers/${driver.userId}/vehicles/${vehicle.data.id}/activar`, { method: 'PATCH' });
console.log(`cliente N.º ${client.userId}, conductor N.º ${driver.userId}`);

async function crearYAsignar() {
  const created = await request(m6, '/api/viajes', { method: 'POST', body: { clienteId: String(client.userId), clientUserId: client.userId, rideRequestId: `demo-${randomUUID()}`, origen: 'Av. 3 de Abril 1050, Corrientes', destino: 'Aeropuerto Internacional Corrientes' } });
  assert.equal(created.status, 201, `M6 crear: ${show(created)}`);
  const assigned = await request(m6, `/api/viajes/${created.data.id}/asignar`, { method: 'POST', body: { conductorId: String(driver.userId), driverUserId: driver.userId } });
  assert.equal(assigned.status, 200, `M6 asignar: ${show(assigned)}`);
  return created.data.id;
}

// Viaje 1: llega el conductor y empieza el viaje.
const viaje1 = await crearYAsignar();
const arrived = await request(m6, `/api/viajes/${viaje1}/arribo`, { method: 'PUT', token: client.token, body: {} });
assert.equal(arrived.status, 200, `M6 arribo: ${show(arrived)}`);
console.log('1) el conductor llegó → aviso "Tu conductor ha llegado"');
await sleep(6000);
const started = await request(m6, `/api/viajes/${viaje1}/iniciar`, { method: 'POST', token: driver.token, body: { token: arrived.data.qr.token } });
assert.equal(started.status, 200, `M6 iniciar: ${show(started)}`);
console.log('2) viaje iniciado con el QR de M8 → aviso "Viaje en curso"');
await sleep(6000);

// Viaje 2: el conductor lo cancela.
const viaje2 = await crearYAsignar();
const cancelled = await request(m6, `/api/viajes/${viaje2}/cancelacion`, { method: 'PATCH', body: { actor: 'conductor', motivo: 'Problema con el vehículo' } });
assert.equal(cancelled.status, 200, `M6 cancelar: ${show(cancelled)}`);
console.log('3) viaje cancelado por el conductor → aviso "Viaje cancelado"');
await sleep(5000);

const sql = `SELECT event_type||' '||status||' '||coalesce(skip_reason,'') FROM notification_delivery.delivery_requests WHERE user_id=${client.userId} AND trip_id IN ('${viaje1}','${viaje2}') ORDER BY created_at`;
console.log('\nEntregas al cliente (RF-8.7):\n' + execFileSync('docker', ['exec', 'movilidad-urbana-m8-postgres-1', 'psql', '-U', 'm8_admin', '-d', 'm8', '-At', '-c', sql]).toString().trim());

// Test integral del stack común: un viaje que recorre los 9 módulos con servicios reales.
//
//   M1  registra pasajero y conductor e inicia la sesión de ambos.
//   M2  crea el perfil del pasajero y, al final, devuelve su historial de viajes.
//   M3  da de alta y habilita al conductor y su vehículo.
//   M4  recibe la ubicación del conductor y la usa para la búsqueda de M5; al iniciar el viaje
//       lo marca ocupado y al finalizar lo vuelve a liberar.
//   M9  programa una reserva para el pasajero (identidad de M1 y tarifa estimada por M7).
//   M5  recibe la solicitud del pasajero, encuentra al conductor y, cuando acepta la oferta,
//       crea y asigna el viaje en M6.
//   M6  ciclo de vida del viaje: arribo, inicio, finalización e historial de transiciones.
//   M8  genera y valida el QR del inicio y emite el comprobante del viaje finalizado.
//   M7  tarifa y pago de la finalización (efectivo por defecto o tarjeta de prueba).
//   RabbitMQ (infraestructura de M9): ninguna cola de mensajes muertos crece durante la prueba.
//
// Requisitos: stack común levantado desde la raíz (docker compose up -d --build) con el .env
// de la raíz y modulo7/.env. Para M9 usar ROUTE_RESOLVER_MODE=m4 y configurar
// M9_DISPATCH_AUTH_TOKEN, compartido con el emisor delegado de M1.
//
// Uso, desde la raíz del repositorio:
//   node --env-file=.env --test tests-integracion/flujo-completo.e2e.mjs
// Si M7 real no está disponible, el test sirve igual con el simulador de su contrato que trae M8
// (modulo8/infra/m7-payments-sandbox), arrancado con UNREGISTERED_TRIPS=not_found para que responda
// como M7: apuntar M6_M7_URL, M8_M7_PAYMENTS_URL, M7_URL y M7_BASE_URL del .env de la raíz a ese
// contenedor y pasar M7_URL con su URL publicada al correr el test.
// Variables opcionales: METODO_PAGO=tarjeta (tokeniza una tarjeta de prueba de Mercado Pago con
// MP_ACCESS_TOKEN de modulo7/.env) y las URL de cada módulo (M1_URL, M2_URL, ...).

import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';

const url = (nombre, defecto) => (process.env[nombre] || defecto).replace(/\/+$/, '');
const M1 = url('M1_URL', 'http://localhost:10000');
const M2 = url('M2_URL', 'http://localhost:11000');
const M3_CONDUCTORES = url('M3_CONDUCTORES_URL', 'http://localhost:5000');
const M3_VEHICULOS = url('M3_VEHICULOS_URL', 'http://localhost:8083');
const M4 = url('M4_URL', 'http://localhost:3004/api/v1');
const M5 = url('M5_URL', 'http://localhost:3005/api/v1');
const M6 = url('M6_URL', 'http://localhost:15000');
const M7 = url('M7_URL', 'http://localhost:17000');
const M8 = url('M8_URL', 'http://localhost:18000');
const M9 = url('M9_URL', 'http://localhost:3000');
const RABBITMQ_ADMIN = url('RABBITMQ_ADMIN_URL', 'http://localhost:15672');
const RABBITMQ_AUTH = Buffer.from(`${process.env.RABBITMQ_USER || 'm9'}:${process.env.RABBITMQ_PASSWORD || 'm9-local'}`).toString('base64');
const METODO_PAGO = process.env.METODO_PAGO || 'efectivo';
const TIPO_VEHICULO = process.env.E2E_TIPO_VEHICULO === 'MOTO' ? 'MOTO' : 'AUTO';
const RECHAZAR_TARJETA_PRIMERO = process.env.E2E_RECHAZO_TARJETA === '1';
const RESERVA_PROGRAMADA = process.env.E2E_RESERVA_PROGRAMADA === '1';
const ESPERA_COMPROBANTE_MS = Number(process.env.ESPERA_COMPROBANTE_MS || 60000);

// Corrientes: el conductor espera en el centro y el pasajero viaja al aeropuerto.
const ORIGEN = { latitude: -27.4692, longitude: -58.8306, address: 'Av. 3 de Abril 1050, Corrientes' };
const DESTINO = { latitude: -27.4459, longitude: -58.7619, address: 'Aeropuerto Internacional Corrientes' };

async function pedir(base, ruta, { method = 'GET', body, token, headers = {} } = {}) {
  const response = await fetch(`${base}${ruta}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const texto = await response.text();
  let data = null;
  try {
    data = texto ? JSON.parse(texto) : null;
  } catch {
    data = { texto };
  }
  return { status: response.status, data };
}
const mostrar = (r) => `HTTP ${r.status} ${JSON.stringify(r.data)}`.slice(0, 600);
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sesionM1(rol, nombre) {
  const email = `integral.${rol.toLowerCase()}.${Date.now()}.${randomInt(1e6)}@movilidad.test`;
  const password = 'Integral-e2e-2026!';
  const registro = await pedir(M1, '/auth/registrar-usuario', {
    method: 'POST',
    body: { nombre, apellido: 'Integral', dni: String(randomInt(20000000, 99999999)), telefono: '+543794000000', email, password, rol },
  });
  assert.ok([200, 201].includes(registro.status), `M1 registro de ${rol}: ${mostrar(registro)}`);
  const login = await pedir(M1, '/auth/iniciar-sesion', { method: 'POST', body: { email, password } });
  assert.equal(login.status, 200, `M1 inicio de sesión de ${rol}: ${mostrar(login)}`);
  const identidad = await pedir(M1, '/auth/validar-identidad-y-rol', { token: login.data.token });
  assert.equal(identidad.status, 200, `M1 validación de ${rol}: ${mostrar(identidad)}`);
  assert.equal(identidad.data.rol ?? identidad.data.role ?? rol, rol);
  return { token: login.data.token, userId: Number(identidad.data.userId) };
}

async function conductorDisponibleEnM4(driverId, esperado, ubicacion = ORIGEN, vehicleType = TIPO_VEHICULO) {
  const query = new URLSearchParams({ latitude: String(ubicacion.latitude), longitude: String(ubicacion.longitude), vehicleType, radiusKm: '1' });
  for (let intento = 0; intento < 30; intento += 1) {
    const r = await pedir(M4, `/drivers/nearby?${query}`);
    assert.equal(r.status, 200, `M4 búsqueda de conductores: ${mostrar(r)}`);
    if (r.data.drivers.some((d) => Number(d.driverId) === driverId) === esperado) return;
    await esperar(500);
  }
  assert.fail(`M4: la disponibilidad del conductor ${driverId} no pasó a ${esperado}`);
}

async function colasMuertas() {
  const r = await fetch(`${RABBITMQ_ADMIN}/api/queues`, { headers: { authorization: `Basic ${RABBITMQ_AUTH}` }, signal: AbortSignal.timeout(10000) });
  assert.equal(r.status, 200, 'No se pudo consultar la API de administración de RabbitMQ');
  const colas = await r.json();
  return Object.fromEntries(colas.filter((c) => /dlq|dead|\.dlx|parking/i.test(c.name)).map((c) => [c.name, c.messages ?? 0]));
}

function tokenMercadoPagoDisponible() {
  if (process.env.MP_ACCESS_TOKEN) return process.env.MP_ACCESS_TOKEN;
  const archivo = new URL('../modulo7/.env', import.meta.url);
  if (!existsSync(archivo)) return undefined;
  return readFileSync(archivo, 'utf8').match(/^MP_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim();
}

async function pagoConTarjeta(titular = 'APRO') {
  const accessToken = tokenMercadoPagoDisponible();
  assert.ok(accessToken?.startsWith('TEST-'), 'Esta prueba requiere un MP_ACCESS_TOKEN de prueba de M7');
  const response = await fetch('https://api.mercadopago.com/v1/card_tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      card_number: '4509953566233704', security_code: '123', expiration_month: 11, expiration_year: 2030,
      cardholder: { name: titular, identification: { type: 'DNI', number: '12345678' } },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({}));
  assert.ok(response.ok && body.id, `Mercado Pago no tokenizó la tarjeta de prueba (HTTP ${response.status})`);
  return { token: body.id, paymentMethodId: 'visa', email: 'pasajero.integral@example.com' };
}

describe('Flujo integral: login, pedido, viaje, pago y comprobante por los 9 módulos', { concurrency: false }, () => {
  const s = {}; // estado compartido entre pasos
  let colasMuertasAntes;

  before(async () => {
    colasMuertasAntes = await colasMuertas();
  });

  test('0. todos los módulos responden', async () => {
    const servicios = [
      ['M1', M1, '/health'], ['M2', M2, '/health/live'], ['M3 conductores', M3_CONDUCTORES, '/health'],
      ['M3 vehículos', M3_VEHICULOS, '/health'], ['M4', M4.replace(/\/api\/v1$/, ''), '/health'],
      ['M5', M5.replace(/\/api\/v1$/, ''), '/health'], ['M6', M6, '/health'], ['M7', M7, '/health'],
      ['M8', M8, '/health/live'], ['M9', M9, '/health'],
    ];
    const caidos = [];
    for (const [nombre, base, ruta] of servicios) {
      const r = await pedir(base, ruta).catch((e) => ({ status: 0, data: e.message }));
      if (r.status !== 200) caidos.push(`${nombre} (${base}${ruta}): ${mostrar(r)}`);
    }
    assert.deepEqual(caidos, [], `Módulos sin responder:\n${caidos.join('\n')}`);
  });

  test('1. M1: pasajero y conductor inician sesión', async () => {
    s.pasajero = await sesionM1('CLIENTE', 'Pasajero');
    s.conductor = await sesionM1('CONDUCTOR', 'Conductor');
  });

  test('2. M2: el pasajero crea su perfil', async () => {
    const perfil = await pedir(M2, '/v1/customers', {
      method: 'POST', token: s.pasajero.token,
      // Canal email: M8 consulta esta preferencia en M2 y omite el push. Con "push" y sin un navegador
      // suscripto, M8 manda cada aviso a la DLQ (FAILED_NO_DEVICE_TOKEN) y el paso 12 fallaría.
      body: { preferences: { preferredVehicleType: 'auto', notificationChannel: 'email' } },
    });
    assert.equal(perfil.status, 201, `M2 alta de perfil: ${mostrar(perfil)}`);
    s.clienteM2 = perfil.data.customerId; // M2 identifica al cliente con su propio id (cust_...)
    assert.equal(perfil.data.userId, s.pasajero.userId, 'M2 debe asociar el perfil al usuario de M1');
    assert.ok(s.clienteM2, `M2 debe devolver el id del cliente: ${mostrar(perfil)}`);
  });

  test('1b. M1: autorización delegada privada para el cliente activo', async () => {
    assert.ok(process.env.M9_DISPATCH_AUTH_TOKEN, 'Ejecutar con node --env-file=.env --test para cargar M9_DISPATCH_AUTH_TOKEN');
    const body = { clientId: String(s.pasajero.userId), audience: 'm5', scope: 'ride-requests:write' };
    const sinCredencial = await pedir(M1, '/auth/token-delegado', { method: 'POST', body });
    assert.equal(sinCredencial.status, 401);
    const delegado = await pedir(M1, '/auth/token-delegado', { method: 'POST', token: process.env.M9_DISPATCH_AUTH_TOKEN, body });
    assert.equal(delegado.status, 200, `M1 emisión delegada: HTTP ${delegado.status}`);
    assert.equal(delegado.data.expires_in, 300);
    const identidad = await pedir(M1, '/auth/validar-identidad-y-rol', { token: delegado.data.access_token });
    assert.equal(identidad.status, 200);
    assert.equal(String(identidad.data.userId), String(s.pasajero.userId));
    const conductor = await pedir(M1, '/auth/token-delegado', {
      method: 'POST', token: process.env.M9_DISPATCH_AUTH_TOKEN,
      body: { ...body, clientId: String(s.conductor.userId) },
    });
    assert.equal(conductor.status, 403, 'M1 no debe delegar identidad de conductor como cliente');
  });

  test('3. M3: conductor habilitado con vehículo activo', async () => {
    const { userId, token } = s.conductor;
    const alta = await pedir(M3_CONDUCTORES, '/api/conductores', { method: 'POST', token, body: { ciudad: 'Corrientes', tipovehiculo: TIPO_VEHICULO.toLowerCase() } });
    assert.equal(alta.status, 201, `M3 alta de conductor: ${mostrar(alta)}`);
    const habilitado = await pedir(M3_CONDUCTORES, `/api/conductores/${userId}/habilitado`, { method: 'PUT', body: { habilitado: 'activo' } });
    assert.equal(habilitado.status, 200, `M3 habilitar conductor: ${mostrar(habilitado)}`);
    const letras = Array.from({ length: 4 }, () => String.fromCharCode(randomInt(65, 91)));
    s.patente = TIPO_VEHICULO === 'MOTO'
      ? `${letras[0]}${randomInt(100, 1000)}${letras.slice(1).join('')}`
      : `${letras.slice(0, 2).join('')}${randomInt(100, 1000)}${letras.slice(2).join('')}`;
    const vehiculo = await pedir(M3_VEHICULOS, `/api/v1/drivers/${userId}/vehicles`, {
      method: 'POST', headers: { 'Idempotency-Key': randomUUID() },
      body: { patente: s.patente, marca: 'Honda', modelo: TIPO_VEHICULO === 'MOTO' ? 'Wave' : 'Civic', anio: 2022, tipoServicio: TIPO_VEHICULO },
    });
    assert.equal(vehiculo.status, 201, `M3 alta de vehículo: ${mostrar(vehiculo)}`);
    const activado = await pedir(M3_VEHICULOS, `/api/v1/drivers/${userId}/vehicles/${vehiculo.data.id}/activar`, { method: 'PATCH' });
    assert.equal(activado.status, 200, `M3 activar vehículo: ${mostrar(activado)}`);
    assert.equal(activado.data.tipoServicio, TIPO_VEHICULO);
  });

  test('4. M4: el conductor publica su ubicación y queda disponible', async () => {
    const { userId, token } = s.conductor;
    s.ubicacionConductor = { latitude: ORIGEN.latitude, longitude: ORIGEN.longitude, vehicleType: TIPO_VEHICULO, available: true };
    const publicada = await pedir(M4, `/drivers/${userId}/location`, { method: 'PUT', token, body: s.ubicacionConductor });
    assert.equal(publicada.status, 200, `M4 publicar ubicación: ${mostrar(publicada)}`);
    await conductorDisponibleEnM4(userId, true);
    await conductorDisponibleEnM4(userId, false, ORIGEN, TIPO_VEHICULO === 'MOTO' ? 'AUTO' : 'MOTO');
    // La ubicación de M4 vence: mantenerla mientras espera el scheduler de M9.
    s.heartbeat = setInterval(() => pedir(M4, `/drivers/${userId}/location`, {
      method: 'PUT', token, body: s.ubicacionConductor,
    }).catch(() => {}), 15000);
  });

  test('5. M9: el pasajero programa una reserva (M1 + tarifa de M7)', async () => {
    const fecha = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const reserva = await pedir(M9, '/reservas', {
      method: 'POST', token: s.pasajero.token,
      body: { origen: ORIGEN.address, destino: DESTINO.address, vehiculo: TIPO_VEHICULO, fechaHoraProgramada: fecha },
    });
    assert.equal(reserva.status, 201, `M9 crear reserva (si responde que no puede resolver la ruta, poner ROUTE_RESOLVER_MODE=stub en el .env de la raíz): ${mostrar(reserva)}`);
    assert.equal(reserva.data.estado, 'PROGRAMADA');
    assert.equal(String(reserva.data.clienteId), String(s.pasajero.userId), 'M9 debe tomar el cliente de la sesión de M1');
    assert.ok(Number(reserva.data.tarifaEstimada) > 0, `M9 debe traer la tarifa estimada por M7: ${mostrar(reserva)}`);
    // Usar las coordenadas reales resueltas por M4 también para el conductor y M6.
    if (reserva.data.routeSnapshot) {
      Object.assign(ORIGEN, reserva.data.routeSnapshot.origin);
      Object.assign(DESTINO, reserva.data.routeSnapshot.destination);
      s.ubicacionConductor = { ...s.ubicacionConductor, latitude: ORIGEN.latitude, longitude: ORIGEN.longitude };
      const ubicada = await pedir(M4, `/drivers/${s.conductor.userId}/location`, {
        method: 'PUT', token: s.conductor.token, body: s.ubicacionConductor,
      });
      assert.equal(ubicada.status, 200, `M4 ubicación en el origen real: ${mostrar(ubicada)}`);
    }
    const consulta = await pedir(M9, `/reservas/${reserva.data.id}`, { token: s.pasajero.token });
    assert.equal(consulta.status, 200, `M9 consultar reserva: ${mostrar(consulta)}`);
    const cancelada = await pedir(M9, `/reservas/${reserva.data.id}`, { method: 'DELETE', token: s.pasajero.token });
    assert.ok([200, 204].includes(cancelada.status), `M9 cancelar reserva: ${mostrar(cancelada)}`);
  });

  test('5b. M9 → M5: la reserva programada genera una oferta sin intervención del pasajero', {
    skip: !RESERVA_PROGRAMADA,
  }, async () => {
    const origen = 'Brasil 200, Corrientes Capital, Argentina';
    const geocode = await pedir(M4, '/geocode', { method: 'POST', body: { address: origen } });
    assert.equal(geocode.status, 200, `M4 geocodificación: ${mostrar(geocode)}`);
    s.origenProgramado = geocode.data;
    s.ubicacionConductor = { latitude: geocode.data.latitude, longitude: geocode.data.longitude, vehicleType: TIPO_VEHICULO, available: true };
    const ubicacion = await pedir(M4, `/drivers/${s.conductor.userId}/location`, {
      method: 'PUT', token: s.conductor.token,
      body: s.ubicacionConductor,
    });
    assert.equal(ubicacion.status, 200, `M4 ubicación de prueba: ${mostrar(ubicacion)}`);
    const creada = await pedir(M9, '/reservas', {
      method: 'POST', token: s.pasajero.token,
      body: {
        origen, destino: 'Lavalle 50, Corrientes Capital, Argentina', vehiculo: TIPO_VEHICULO,
        fechaHoraProgramada: new Date(Date.now() + 12_000).toISOString(),
      },
    });
    assert.equal(creada.status, 201, `M9 programar despacho: ${mostrar(creada)}`);
    assert.equal(creada.data.estado, 'PROGRAMADA');
    s.reservaProgramada = creada.data.id;
    const ajena = await pedir(M9, `/reservas/${s.reservaProgramada}`, { token: s.conductor.token });
    assert.ok([403, 404].includes(ajena.status), 'Otro usuario no debe consultar la reserva');
    let consulta;
    const limite = Date.now() + 45_000;
    while (Date.now() < limite) {
      consulta = await pedir(M9, `/reservas/${s.reservaProgramada}`, { token: s.pasajero.token });
      assert.equal(consulta.status, 200, `M9 estado de la reserva: ${mostrar(consulta)}`);
      assert.notEqual(consulta.data.estado, 'FALLIDA', 'M9 debe despachar con un conductor disponible');
      if (consulta.data.idSolicitud) {
        const ofertas = await pedir(M5, `/drivers/${s.conductor.userId}/offers`, { token: s.conductor.token });
        assert.equal(ofertas.status, 200, `M5 consultar ofertas: ${mostrar(ofertas)}`);
        const oferta = ofertas.data.offers.find((oferta) =>
          oferta.requestId === consulta.data.idSolicitud && oferta.status === 'PENDING');
        if (oferta) {
          s.ofertaProgramada = oferta;
          s.rideRequestId = consulta.data.idSolicitud;
          const solicitud = await pedir(M5, `/ride-requests/${s.rideRequestId}`, { token: s.pasajero.token });
          assert.equal(solicitud.status, 200, `M5 consultar el recorrido: ${mostrar(solicitud)}`);
          assert.equal(String(solicitud.data.clientId), String(s.pasajero.userId));
          s.recorridoProgramado = { origen: solicitud.data.origin, destino: solicitud.data.destination };
          return;
        }
      }
      await esperar(1000);
    }
    assert.fail(`M9 no generó la oferta a tiempo: ${mostrar(consulta)}`);
  });

  test('6. M5: el pasajero pide el viaje y el conductor acepta la oferta', async () => {
    const pasajero = s.pasajero;
    const conductor = s.conductor;
    let oferta = s.ofertaProgramada;
    if (!RESERVA_PROGRAMADA) {
      const solicitud = await pedir(M5, '/ride-requests', {
        method: 'POST', token: pasajero.token, headers: { 'Idempotency-Key': randomUUID() },
        body: { origin: ORIGEN, destination: DESTINO, vehicleType: TIPO_VEHICULO },
      });
      assert.equal(solicitud.status, 201, `M5 solicitud de viaje: ${mostrar(solicitud)}`);
      assert.equal(solicitud.data.status, 'SEARCHING');
      s.rideRequestId = solicitud.data.id;

      const candidatos = await pedir(M5, `/ride-requests/${s.rideRequestId}/candidates`, {
        method: 'POST', token: pasajero.token, headers: { 'X-User-Id': String(pasajero.userId) }, body: { radiusKm: 1, maxCandidates: 5 },
      });
      assert.equal(candidatos.status, 200, `M5 búsqueda de candidatos: ${mostrar(candidatos)}`);
      assert.ok(candidatos.data.candidates.some((c) => String(c.driverId) === String(conductor.userId)), 'M5 debe encontrar al conductor publicado en M4');

      const ofertas = await pedir(M5, `/ride-requests/${s.rideRequestId}/offers`, {
        method: 'POST', token: pasajero.token,
        body: { driverIds: [String(conductor.userId)], ttlSeconds: 45 },
      });
      assert.equal(ofertas.status, 201, `M5 envío de ofertas: ${mostrar(ofertas)}`);
      oferta = (ofertas.data.offers ?? ofertas.data)[0];
    }
    assert.ok(oferta?.id, 'M5 debe devolver una oferta para el conductor de prueba');
    assert.equal(oferta.vehicleType, TIPO_VEHICULO);

    const aceptada = await pedir(M5, `/offers/${oferta.id}/accept`, {
      method: 'POST', token: conductor.token, headers: { 'X-User-Id': String(conductor.userId) }, body: {},
    });
    assert.equal(aceptada.status, 200, `M5 aceptar oferta: ${mostrar(aceptada)}`);
    assert.equal(aceptada.data.requestStatus, 'ASSIGNED');
    if (s.reservaProgramada) {
      let estado;
      const limite = Date.now() + 15_000;
      do {
        const actual = await pedir(M9, `/reservas/${s.reservaProgramada}`, { token: pasajero.token });
        assert.equal(actual.status, 200, `M9 consultar asignación: ${mostrar(actual)}`);
        estado = actual.data.estado;
        if (estado === 'ACTIVADA') {
          assert.equal(String(actual.data.assignedDriverId), String(conductor.userId));
          break;
        }
        await esperar(500);
      } while (Date.now() < limite);
      assert.equal(estado, 'ACTIVADA');
    }
  });

  test('7. M6: M5 creó y asignó el viaje', async () => {
    const r = await pedir(M6, `/api/viajes?clienteId=${s.pasajero.userId}`);
    assert.equal(r.status, 200, `M6 registro de viajes: ${mostrar(r)}`);
    const detalles = await Promise.all(r.data.viajes.map(({ id }) => pedir(M6, `/api/viajes/${id}`, { token: s.pasajero.token })));
    const asignados = detalles.filter(({ status, data }) => status === 200 && data.rideRequestId === s.rideRequestId);
    assert.equal(asignados.length, 1, 'M5 debe crear un único viaje para esta solicitud');
    const [{ data: viaje }] = asignados;
    assert.equal(String(viaje.conductorId), String(s.conductor.userId));
    assert.equal(viaje.estado, 'CONDUCTOR_EN_CAMINO');
    s.tripId = viaje.id;
  });

  test('8. M6 + M8: arribo con QR e inicio validado; M4 marca al conductor ocupado', async () => {
    clearInterval(s.heartbeat);
    const arribo = await pedir(M6, `/api/viajes/${s.tripId}/arribo`, { method: 'PUT', token: s.pasajero.token, body: {} });
    assert.equal(arribo.status, 200, `M6 arribo: ${mostrar(arribo)}`);
    assert.ok(arribo.data.qr?.token, 'M8 debe emitir el QR del viaje');
    const inicio = await pedir(M6, `/api/viajes/${s.tripId}/iniciar`, { method: 'POST', token: s.conductor.token, body: { codigoVerificacion: arribo.data.qr.token } });
    assert.equal(inicio.status, 200, `M6 inicio: ${mostrar(inicio)}`);
    const reuso = await pedir(M6, `/api/viajes/${s.tripId}/iniciar`, { method: 'POST', token: s.conductor.token, body: { codigoVerificacion: arribo.data.qr.token } });
    assert.notEqual(reuso.status, 200, 'El QR de M8 no debe servir dos veces');
    await conductorDisponibleEnM4(s.conductor.userId, false, s.origenProgramado);
  });

  const solicitarOtroViaje = () => pedir(M5, '/ride-requests', {
    method: 'POST', token: s.pasajero.token, headers: { 'Idempotency-Key': randomUUID() },
    body: { origin: ORIGEN, destination: DESTINO, vehicleType: TIPO_VEHICULO },
  });

  test('8b. M5 impide una segunda solicitud mientras el viaje está en curso', async () => {
    const intento = await solicitarOtroViaje();
    assert.equal(intento.status, 409, mostrar(intento));
    assert.equal(intento.data.code, 'ACTIVE_REQUEST_EXISTS');
  });

  test(`9. M6 + M4 + M7: finalización y pago (${METODO_PAGO}); M4 libera al conductor`, async () => {
    const destino = await pedir(M6, '/api/viajes/' + s.tripId + '/destino', { method: 'POST', token: s.conductor.token, body: {} });
    assert.equal(destino.status, 200, 'M6 debe registrar la llegada antes del pago');
    const ruta = `/api/viajes/${s.tripId}/finalizacion`;
    const finalizacion = {
      ...(s.recorridoProgramado ?? { origen: ORIGEN, destino: DESTINO }),
      tipoVehiculo: TIPO_VEHICULO.toLowerCase(), horaFin: new Date().toISOString(), gestionarPago: true,
    };
    if (RECHAZAR_TARJETA_PRIMERO) {
      assert.ok(['efectivo', 'transferencia'].includes(METODO_PAGO));
      const rechazo = await pedir(M6, ruta, {
        token: s.pasajero.token, method: 'POST',
        body: { ...finalizacion, metodoPago: 'tarjeta', pago: await pagoConTarjeta('OTHE') },
      });
      assert.equal(rechazo.status, 402, mostrar(rechazo));
      assert.match(rechazo.data.error, /tarjeta fue rechazada/i);
    }
    const fin = await pedir(M6, ruta, {
      token: s.pasajero.token,
      method: 'POST',
      body: {
        ...finalizacion, metodoPago: METODO_PAGO,
        ...(METODO_PAGO === 'tarjeta' ? { pago: await pagoConTarjeta() } : {}),
      },
    });
    assert.equal(fin.status, 200, `M6 finalización: ${mostrar(fin)}`);
    s.total = fin.data.viaje.total;
    assert.equal(fin.data.fuenteMetrica, 'M4', 'La distancia y el tiempo estimado deben venir de M4');
    assert.ok(Number(s.total) > 0, 'M7 debe calcular la tarifa');
    assert.ok(fin.data.paymentId, 'M7 debe registrar el pago');
    // Tarjeta: M7 la autoriza en Mercado Pago. Efectivo y transferencia se cobran fuera de la
    // pasarela y M7 los deja pendientes.
    assert.equal(fin.data.estadoPago, METODO_PAGO === 'tarjeta' ? 'autorizado' : 'pendiente');
    await conductorDisponibleEnM4(s.conductor.userId, true, s.origenProgramado);
  });

  test('10. M8: comprobante emitido a partir de TripCompleted', async () => {
    let comprobante;
    const limite = Date.now() + ESPERA_COMPROBANTE_MS;
    while (Date.now() < limite) {
      comprobante = await pedir(M8, `/api/v1/receipts/${s.tripId}`, { token: s.pasajero.token });
      if (comprobante.status === 200) break;
      assert.equal(comprobante.status, 404, `M8 comprobante: ${mostrar(comprobante)}`);
      await esperar(1500);
    }
    assert.equal(comprobante?.status, 200, `M8 no emitió el comprobante en ${ESPERA_COMPROBANTE_MS} ms`);
    const datos = comprobante.data.data ?? comprobante.data;
    assert.equal(datos.tripId, s.tripId);
    assert.equal(datos.customer.id, String(s.pasajero.userId));
    assert.equal(datos.driver.vehicle.plate, s.patente, 'M8 debe tomar la patente de M3');
    assert.equal(datos.fare.total, s.total);
    assert.equal(datos.payment.method, METODO_PAGO.toUpperCase());
    const pdf = await fetch(`${M8}/api/v1/receipts/${s.tripId}/pdf`, {
      headers: { authorization: `Bearer ${s.pasajero.token}` },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(pdf.status, 200);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  });

  test('10b. M5 permite pedir otro viaje al finalizar y sólo acepta uno en simultáneo', async () => {
    const intentos = await Promise.all([solicitarOtroViaje(), solicitarOtroViaje()]);
    assert.deepEqual(intentos.map(intento => intento.status).sort(), [201, 409], intentos.map(mostrar).join(' | '));
    const nuevo = intentos.find(intento => intento.status === 201);
    assert.notEqual(nuevo.data.id, s.rideRequestId);
    const cancelado = await pedir(M5, `/ride-requests/${nuevo.data.id}/cancel`, {
      method: 'POST', token: s.pasajero.token, body: { reason: 'Fin de la prueba de nueva solicitud.' },
    });
    assert.equal(cancelado.status, 200, mostrar(cancelado));
  });

  test('11. M6 + M2: historial de transiciones completo y viaje visible en M2', async () => {
    const historial = await pedir(M6, `/api/viajes/${s.tripId}/historial-transiciones`);
    assert.equal(historial.status, 200, `M6 historial: ${mostrar(historial)}`);
    assert.deepEqual(historial.data.historial.map((t) => t.to), ['solicitado', 'conductor en camino', 'arribado', 'en curso', 'completado']);
    const viajesM2 = await pedir(M2, `/v1/customers/${s.clienteM2}/trips`, { token: s.pasajero.token });
    assert.equal(viajesM2.status, 200, `M2 historial de viajes: ${mostrar(viajesM2)}`);
    const lista = viajesM2.data.data?.trips ?? viajesM2.data.trips ?? viajesM2.data.data ?? [];
    assert.ok(JSON.stringify(lista).includes(s.tripId), `M2 debe mostrar el viaje ${s.tripId}: ${mostrar(viajesM2)}`);
  });

  after(async () => {
    clearInterval(s.heartbeat);
    if (s.reservaProgramada) {
      const path = `/reservas/${s.reservaProgramada}`;
      const reserva = await pedir(M9, path, { token: s.pasajero.token }).catch(() => null);
      if (reserva?.data?.estado === 'PROGRAMADA') {
        await pedir(M9, path, { method: 'DELETE', token: s.pasajero.token }).catch(() => {});
      }
    }
    if (s.conductor) await pedir(M4, `/drivers/${s.conductor.userId}/location`, { method: 'DELETE', token: s.conductor.token }).catch(() => {});
  });

  test('11a. M8: cada participante consulta sus avisos sin suscripción PUSH', async () => {
    const path = '/notifications/me';
    assert.equal((await pedir(M8, path)).status, 401);
    const limite = Date.now() + 15_000;
    do {
      const [pasajero, conductor] = await Promise.all([
        pedir(M8, path, { token: s.pasajero.token }),
        pedir(M8, path + '?userId=' + s.pasajero.userId, { token: s.conductor.token }),
      ]);
      assert.equal(pasajero.status, 200);
      assert.equal(conductor.status, 200);
      if (pasajero.data.data.some(aviso => aviso.title === 'Conductor asignado') &&
          conductor.data.data.some(aviso => aviso.title === 'Viaje asignado')) {
        const idsDelPasajero = new Set(pasajero.data.data.map(aviso => aviso.id));
        assert.ok(conductor.data.data.every(aviso => !idsDelPasajero.has(aviso.id)));
        return;
      }
      await esperar(300);
    } while (Date.now() < limite);
    assert.fail('No llegaron los avisos de asignación a ambas cuentas');
  });

  test('11b. M8: soporte lista únicamente los tickets del usuario autenticado', async () => {
    const ticketsPath = '/tickets';
    const propio = await pedir(M8, ticketsPath, {
      method: 'POST', token: s.pasajero.token, body: { tripId: s.tripId, motivo: 'Consulta E2E del pasajero' },
    });
    const ajeno = await pedir(M8, ticketsPath, {
      method: 'POST', token: s.conductor.token, body: { tripId: s.tripId, motivo: 'Consulta E2E del conductor' },
    });
    assert.equal(propio.status, 201, mostrar(propio));
    assert.equal(ajeno.status, 201, mostrar(ajeno));
    const consulta = await pedir(M8, `${ticketsPath}/mios?tripId=${s.tripId}`, { token: s.pasajero.token });
    assert.equal(consulta.status, 200, mostrar(consulta));
    assert.deepEqual(consulta.data.map(ticket => ticket.id), [propio.data.id]);
    assert.equal((await pedir(M8, ticketsPath, { token: s.pasajero.token })).status, 403);
    if (process.env.M1_OPERADOR_PASSWORD) {
      const sesion = await pedir(M1, '/auth/iniciar-sesion', {
        method: 'POST',
        body: { email: process.env.M1_OPERADOR_EMAIL || 'operador@movilidad.com', password: process.env.M1_OPERADOR_PASSWORD },
      });
      assert.equal(sesion.status, 200, 'M1 debe iniciar sesión como operador');
      const token = sesion.data.token;
      const bandeja = await pedir(M8, `${ticketsPath}?tripId=${s.tripId}`, { token });
      assert.equal(bandeja.status, 200, 'El operador debe ver los dos tickets');
      assert.equal(bandeja.data.length, 2);
      const motivo = 'Recibimos tu consulta y estamos revisando el viaje.';
      const path = `${ticketsPath}/${propio.data.id}`;
      const respuesta = await pedir(M8, path + '/estado', {
        method: 'PATCH', token,
        body: { estado: 'ABIERTO', motivo, expectedVersion: propio.data.version, registrarRespuesta: true },
      });
      assert.equal(respuesta.status, 200, mostrar(respuesta));
      assert.equal(respuesta.data.estado, 'ABIERTO');
      const historial = await pedir(M8, path + '/historial', { token: s.pasajero.token });
      assert.equal(historial.status, 200);
      assert.ok(historial.data.some(entrada => entrada.motivo === motivo));
      assert.equal((await pedir(M8, path + '/historial', { token: s.conductor.token })).status, 403);
    }
  });

  test('12. RabbitMQ: ninguna cola de mensajes muertos creció', async () => {
    const despues = await colasMuertas();
    const crecieron = Object.entries(despues)
      .filter(([nombre, cantidad]) => cantidad > (colasMuertasAntes[nombre] ?? 0))
      .map(([nombre, cantidad]) => `${nombre}: ${colasMuertasAntes[nombre] ?? 0} → ${cantidad}`);
    assert.deepEqual(crecieron, [], `Colas de mensajes muertos con mensajes nuevos:\n${crecieron.join('\n')}`);
  });
});

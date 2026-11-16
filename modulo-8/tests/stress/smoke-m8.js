import http from 'k6/http';
import { check, sleep } from 'k6';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';

// Smoke Test: 1 solo usuario virtual (1 VU), 1 sola iteración (mínimo impacto en Free Tier)
export const options = {
  vus: 1,
  iterations: 1,
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';
const JWT_SECRET = __ENV.M1_JWT_SECRET || 'local-dev-m1-secret-not-for-production';
const MODE = (__ENV.SMOKE_MODE || 'all').toLowerCase();

function createM1Token(userId = 91, role = 'CLIENTE') {
  const header = encoding.b64encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'rawurl');
  const payload = encoding.b64encode(
    JSON.stringify({
      userId,
      role,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    'rawurl',
  );
  const signature = crypto.hmac('sha256', JWT_SECRET, `${header}.${payload}`, 'base64rawurl');
  return `Bearer ${header}.${payload}.${signature}`;
}

function runNotificationsSmoke(runId) {
  console.log('\n[RF8.1 - Notificaciones de Viaje]');
  const res = http.post(
    `${BASE_URL}/notifications`,
    JSON.stringify({
      tripId: `${runId}-trip-notif`,
      recipientId: '91',
      eventType: 'DRIVER_ASSIGNED',
      channels: ['PUSH'],
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, {
    '[RF8.1] POST /notifications retorna 201 PROCESSED': (r) => r.status === 201,
  });
  console.log(`   [OK] POST /notifications -> ${res.status} (${res.timings.duration.toFixed(1)}ms)`);
}

function runQrSmoke(runId) {
  console.log('\n[RF8.2 - QR de Verificacion]');
  const tripId = `${runId}-trip-qr`;
  const genRes = http.post(
    `${BASE_URL}/qr`,
    JSON.stringify({ tripId }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(genRes, {
    '[RF8.2] POST /qr genera token con 201': (r) => r.status === 201,
  });
  console.log(`   [OK] POST /qr -> ${genRes.status} (${genRes.timings.duration.toFixed(1)}ms)`);

  const token = genRes.json('token');
  const valRes = http.post(
    `${BASE_URL}/qr/validate`,
    JSON.stringify({ tripId, token }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(valRes, {
    '[RF8.2] POST /qr/validate consume token con 200': (r) => r.status === 200,
  });
  console.log(`   [OK] POST /qr/validate (1er uso) -> ${valRes.status} (${valRes.timings.duration.toFixed(1)}ms)`);

  const reuseRes = http.post(
    `${BASE_URL}/qr/validate`,
    JSON.stringify({ tripId, token }),
    { headers: { 'Content-Type': 'application/json', 'X-Expect-Conflict': 'true' } },
  );
  check(reuseRes, {
    '[RF8.2] POST /qr/validate rechaza reuso con 409': (r) => r.status === 409,
  });
  console.log(`   [OK] POST /qr/validate (reuso bloqueado) -> ${reuseRes.status} (${reuseRes.timings.duration.toFixed(1)}ms)`);
}

function runReceiptsSmoke(runId) {
  console.log('\n[RF8.3 & RF8.4 - Comprobante PDF y Referencia de Reenvio]');
  const tripId = `${runId}-trip-receipt`;
  const payload = JSON.stringify({
    tripId,
    customer: { id: `${runId}-cli`, fullName: 'Cliente Smoke', email: 'smoke@example.com' },
    driver: {
      id: `${runId}-drv`,
      fullName: 'Conductor Smoke',
      vehicle: { type: 'AUTO', plate: 'SMK123' },
    },
    trip: {
      origin: 'Facultad Regional',
      destination: 'Centro Civico',
      startedAt: '2026-09-01T18:00:00.000Z',
      finishedAt: '2026-09-01T18:20:00.000Z',
      distanceKm: 5,
      durationMin: 20,
    },
    fare: { currency: 'ARS', total: 2500 },
    payment: { method: 'BILLETERA', status: 'APROBADO' },
  });

  const issueRes = http.post(`${BASE_URL}/api/v1/receipts`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  check(issueRes, {
    '[RF8.3] POST /api/v1/receipts emite comprobante con 201': (r) => r.status === 201,
  });
  console.log(`   [OK] POST /api/v1/receipts -> ${issueRes.status} (${issueRes.timings.duration.toFixed(1)}ms)`);

  const pdfRes = http.get(`${BASE_URL}/api/v1/receipts/${tripId}/pdf`, {
    headers: { Authorization: 'Bearer e2e-operator' },
  });
  check(pdfRes, {
    '[RF8.3] GET /api/v1/receipts/:tripId/pdf descarga PDF con 200': (r) => r.status === 200,
  });
  console.log(`   [OK] GET /api/v1/receipts/:tripId/pdf -> ${pdfRes.status} (${pdfRes.timings.duration.toFixed(1)}ms)`);

  const refRes = http.get(`${BASE_URL}/internal/receipts/${tripId}/delivery-reference`);
  check(refRes, {
    '[RF8.4] GET /internal/receipts/:tripId/delivery-reference genera link temporal con 200': (r) =>
      r.status === 200,
  });
  console.log(
    `   [OK] GET /internal/receipts/:tripId/delivery-reference -> ${refRes.status} (${refRes.timings.duration.toFixed(1)}ms)`,
  );
}

function runSupportSmoke(runId) {
  console.log('\n[RF8.5 & RF8.6 - Soporte y Publicacion RabbitMQ]');
  const ticketRes = http.post(
    `${BASE_URL}/tickets`,
    JSON.stringify({
      viajeId: `${runId}-trip-support`,
      motivo: 'Verificacion de observabilidad en vivo',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(ticketRes, {
    '[RF8.5] POST /tickets crea ticket con 201': (r) => r.status === 201,
  });
  console.log(`   [OK] POST /tickets -> ${ticketRes.status} (${ticketRes.timings.duration.toFixed(1)}ms)`);

  const eventRes = http.post(
    `${BASE_URL}/events/publish`,
    JSON.stringify({
      routingKey: 'viaje.completado',
      payload: { viajeId: `${runId}-trip-rmq`, importe: 2500 },
      count: 1,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(eventRes, {
    '[RF8.6] POST /events/publish publica en RabbitMQ con 200': (r) => r.status === 200,
  });
  console.log(`   [OK] POST /events/publish -> ${eventRes.status} (${eventRes.timings.duration.toFixed(1)}ms)`);
}

function runDeliverySmoke(runId) {
  console.log('\n[RF8.7 - Entrega de Notificaciones y Device Tokens]');
  const authHeader = createM1Token(91, 'CLIENTE');
  const tokenValue = `fcm-smoke-${runId}`;
  const authParams = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
  };

  const regRes = http.post(
    `${BASE_URL}/devices/tokens`,
    JSON.stringify({ token: tokenValue, platform: 'ANDROID' }),
    authParams,
  );
  check(regRes, {
    '[RF8.7] POST /devices/tokens registra token con 201': (r) => r.status === 201,
  });
  console.log(`   [OK] POST /devices/tokens -> ${regRes.status} (${regRes.timings.duration.toFixed(1)}ms)`);

  const listRes = http.get(`${BASE_URL}/devices/tokens`, authParams);
  check(listRes, {
    '[RF8.7] GET /devices/tokens lista tokens activos con 200': (r) => r.status === 200,
  });
  console.log(`   [OK] GET /devices/tokens -> ${listRes.status} (${listRes.timings.duration.toFixed(1)}ms)`);

  const delRes = http.del(`${BASE_URL}/devices/tokens/${tokenValue}`, null, authParams);
  check(delRes, {
    '[RF8.7] DELETE /devices/tokens/:token desactiva token con 200': (r) => r.status === 200,
  });
  console.log(`   [OK] DELETE /devices/tokens/:token -> ${delRes.status} (${delRes.timings.duration.toFixed(1)}ms)`);
}

export default function () {
  const runId = `smk-${Date.now()}`;
  console.log(`\n=============================================================`);
  console.log(`[K6 Smoke Test M8] Modo: ${MODE.toUpperCase()} | Target: ${BASE_URL}`);
  console.log(`=============================================================`);

  if (MODE === 'all' || MODE === 'notifications' || MODE === 'rf81') {
    runNotificationsSmoke(runId);
    sleep(0.3);
  }
  if (MODE === 'all' || MODE === 'qr' || MODE === 'rf82') {
    runQrSmoke(runId);
    sleep(0.3);
  }
  if (MODE === 'all' || MODE === 'receipts' || MODE === 'rf83' || MODE === 'rf84') {
    runReceiptsSmoke(runId);
    sleep(0.3);
  }
  if (MODE === 'all' || MODE === 'support' || MODE === 'rf85' || MODE === 'rf86') {
    runSupportSmoke(runId);
    sleep(0.3);
  }
  if (MODE === 'all' || MODE === 'delivery' || MODE === 'rf87') {
    runDeliverySmoke(runId);
    sleep(0.3);
  }

  const metricsRes = http.get(`${BASE_URL}/metrics`);
  check(metricsRes, {
    '[M8] GET /metrics expone metricas Prometheus con 200': (r) =>
      r.status === 200 && r.body.includes('http_requests_total'),
  });
  console.log(
    `\n[INFO] GET /metrics verificado (${metricsRes.body.length} bytes). Datos listos para Grafana Cloud.\n`,
  );
}

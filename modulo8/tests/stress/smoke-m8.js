import http from 'k6/http';
import { check } from 'k6';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: { checks: ['rate==1'] },
};

const base = __ENV.TARGET_URL || 'http://host.docker.internal:8000';
const mode = __ENV.SMOKE_MODE || 'http';
const json = { 'Content-Type': 'application/json' };

// La segunda operación sobre un QR consumido debe recibir 409.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409));

function verify(response, label, expectedStatus, extra = () => true) {
  check(response, {
    [label]: (result) => result.status === expectedStatus && extra(result),
  });
  if (__ENV.SMOKE_VERBOSE !== 'false') {
    console.log(`${label}: HTTP ${response.status} (${response.timings.duration.toFixed(0)} ms)`);
  }
  return response;
}

function createM1Token() {
  const header = encoding.b64encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'rawurl');
  const payload = encoding.b64encode(JSON.stringify({
    userId: 91,
    role: 'CLIENTE',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }), 'rawurl');
  const signature = crypto.hmac('sha256', __ENV.M1_JWT_SECRET, `${header}.${payload}`, 'base64rawurl');
  return `Bearer ${header}.${payload}.${signature}`;
}

function qrOperationId(runId, suffix) {
  const hash = crypto.sha256(`${runId}-${suffix}`, 'hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function runQr(runId) {
  const tripId = `${runId}-qr`;
  const headers = { ...json, 'x-api-key': __ENV.QR_INTERNAL_API_KEY };
  const generated = verify(http.post(`${base}/qr`, JSON.stringify({ tripId }), { headers }),
    'RF8.2 genera QR', 201, (r) => Boolean(r.json('token')));
  if (generated.status !== 201) return;
  const body = JSON.stringify({ tripId, token: generated.json('token') });
  const operationHeaders = { ...headers, 'Idempotency-Key': qrOperationId(runId, 'first') };
  verify(http.post(`${base}/qr/validate`, body, { headers: operationHeaders }),
    'RF8.2 valida QR', 200, (r) => r.json('valid') === true);
  verify(http.post(`${base}/qr/validate`, body, { headers: operationHeaders }),
    'RF8.2 repite la misma operacion', 200, (r) => r.json('valid') === true);
  verify(http.post(`${base}/qr/validate`, body, {
    headers: { ...headers, 'Idempotency-Key': qrOperationId(runId, 'second') },
  }), 'RF8.2 bloquea otra operacion sobre el QR', 409);
}

function runReceipts(runId) {
  const tripId = `${runId}-receipt`;
  const payload = {
    tripId,
    customer: { id: `${runId}-customer`, fullName: 'Cliente Smoke', email: 'smoke@example.com' },
    driver: { id: `${runId}-driver`, fullName: 'Conductor Smoke', vehicle: { type: 'AUTO', plate: 'SMK123' } },
    trip: { origin: 'Facultad', destination: 'Centro', startedAt: '2026-09-01T18:00:00.000Z', finishedAt: '2026-09-01T18:20:00.000Z', distanceKm: 5, durationMin: 20 },
    fare: { currency: 'ARS', total: 2500 },
    payment: { method: 'BILLETERA', status: 'APROBADO' },
  };
  const issued = verify(http.post(`${base}/api/v1/receipts`, JSON.stringify(payload), { headers: json }),
    'RF8.3 emite comprobante', 201);
  if (issued.status !== 201) return;
  const headers = { Authorization: 'Bearer e2e-operator' };
  verify(http.get(`${base}/api/v1/receipts/${tripId}/pdf`, { headers }),
    'RF8.3 descarga PDF', 200, (r) => r.headers['Content-Type']?.includes('application/pdf'));
  verify(http.get(`${base}/internal/receipts/${tripId}/delivery-reference`, { headers }),
    'RF8.4 obtiene referencia temporal', 200);
  verify(http.post(`${base}/api/v1/receipts/${tripId}/resend`, JSON.stringify({ channel: 'EMAIL' }),
    { headers: { ...headers, ...json } }), 'RF8.4 solicita reenvio', 202);
}

function runSupport(runId) {
  verify(http.post(`${base}/tickets`, JSON.stringify({
    viajeId: `${runId}-support`, motivo: 'Prueba de observabilidad M8',
  }), { headers: json }), 'RF8.5 abre ticket', 201);
}

function runDelivery(runId) {
  const token = `fcm-smoke-${runId}`;
  const headers = { ...json, Authorization: createM1Token() };
  verify(http.post(`${base}/devices/tokens`, JSON.stringify({ token, platform: 'ANDROID' }), { headers }),
    'RF8.7 registra token', 201);
  verify(http.get(`${base}/devices/tokens`, { headers }), 'RF8.7 lista tokens', 200);
  verify(http.del(`${base}/devices/tokens/${token}`, null, { headers }), 'RF8.7 desactiva token', 200);
}

export default function () {
  const runId = `smoke-${__ENV.SMOKE_RUN_ID || Date.now()}-${__VU}-${__ITER}`;
  verify(http.get(`${base}/health/live`), 'M8 esta vivo', 200);
  if (mode === 'http' || mode === 'qr') runQr(runId);
  if (mode === 'http' || mode === 'receipts') runReceipts(runId);
  if (mode === 'http' || mode === 'support') runSupport(runId);
  if (mode === 'http' || mode === 'delivery') runDelivery(runId);
  verify(http.get(`${base}/metrics`), 'M8 expone metricas', 200,
    (r) => r.body.includes('http_requests_total'));
}

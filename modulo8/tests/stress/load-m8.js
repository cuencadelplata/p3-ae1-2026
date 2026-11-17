import http from 'k6/http';
import { check, sleep } from 'k6';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';

const base = __ENV.TARGET_URL;
const mode = __ENV.LOAD_MODE;
const maxVus = Number(__ENV.LOAD_VUS);
const duration = Number(__ENV.LOAD_DURATION_SECONDS);
const pattern = __ENV.LOAD_PATTERN || 'ramp';
const runId = __ENV.RUN_ID;
const json = { 'Content-Type': 'application/json' };
const rampTargets = [0.2, 0.4, 0.6, 0.8, 1].map((share) => Math.max(1, Math.round(maxVus * share)));
const rampRequests = Array.from({ length: 5 }, (_, index) => new Counter(`m8_ramp_stage_${index + 1}_requests`));
const rampFailures = Array.from({ length: 5 }, (_, index) => new Counter(`m8_ramp_stage_${index + 1}_failures`));
const measuredRfs = mode === 'mixed' ? ['RF8.2', 'RF8.3', 'RF8.4', 'RF8.5', 'RF8.7'] : [];

export const options = {
  scenarios: pattern === 'constant'
    ? { constant: { executor: 'constant-vus', vus: maxVus, duration: `${duration}s` } }
    : pattern === 'step45'
      ? { incremental: {
        executor: 'ramping-vus',
        stages: [...rampTargets.map((target) => ({ duration: '8s', target })),
          { duration: '5s', target: maxVus }],
        gracefulRampDown: '5s',
      } }
    : {
      gradual: {
        executor: 'ramping-vus',
        stages: [
          { duration: `${duration}s`, target: maxVus },
          { duration: `${duration}s`, target: maxVus },
          { duration: '5s', target: 0 },
        ],
        gracefulRampDown: '5s',
      },
    },
  thresholds: {
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
    ...Object.fromEntries(measuredRfs.flatMap((rf) => [
      [`http_reqs{rf:${rf}}`, ['count>=0']],
      [`http_req_duration{rf:${rf}}`, ['p(95)<1000']],
    ])),
  },
};

function valid(response, label, status, extra = () => true) {
  const passed = check(response, { [label]: (result) => result.status === status && extra(result) });
  if (pattern === 'step45') {
    const elapsed = Date.now() - exec.scenario.startTime;
    const index = Math.min(4, Math.max(0, Math.floor(elapsed / 8000)));
    rampRequests[index].add(1);
    if (!passed) rampFailures[index].add(1);
  }
}

function operationId(value) {
  const hash = crypto.sha256(value, 'hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function bearerToken() {
  const header = encoding.b64encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'rawurl');
  const payload = encoding.b64encode(JSON.stringify({
    userId: 91, role: 'CLIENTE', exp: Math.floor(Date.now() / 1000) + 3600,
  }), 'rawurl');
  const signature = crypto.hmac('sha256', __ENV.M1_JWT_SECRET, `${header}.${payload}`, 'base64rawurl');
  return `Bearer ${header}.${payload}.${signature}`;
}

export function setup() {
  if (!['receipts', 'resend', 'mixed'].includes(mode)) return {};
  const tripId = `load-${runId}-receipt`;
  const request = {
    tripId,
    customer: { id: '91', fullName: 'Cliente Carga', email: 'load@example.com' },
    driver: { id: '101', fullName: 'Conductor Carga', vehicle: { type: 'AUTO', plate: 'LOAD123' } },
    trip: {
      origin: 'Origen', destination: 'Destino', startedAt: '2026-09-01T18:00:00.000Z',
      finishedAt: '2026-09-01T18:20:00.000Z', distanceKm: 5, durationMin: 20,
    },
    fare: { currency: 'ARS', total: 2500 },
    payment: { method: 'BILLETERA', status: 'APROBADO' },
  };
  const response = http.post(`${base}/api/v1/receipts`, JSON.stringify(request), { headers: json });
  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`No se pudo preparar el comprobante: HTTP ${response.status}`);
  }
  return { tripId };
}

export default function (data) {
  const selected = mode === 'mixed'
    ? ['support', 'qr', 'receipts', 'resend', 'delivery'][(__VU + __ITER) % 5]
    : mode;
  if (selected === 'support') {
    valid(http.get(`${base}/tickets?limit=10`, { tags: { rf: 'RF8.5' } }), 'RF8.5 lista tickets', 200);
  } else if (selected === 'qr') {
    const tripId = `load-${runId}-${__VU}-${__ITER}`;
    const headers = { ...json, 'x-api-key': __ENV.QR_INTERNAL_API_KEY };
    const created = http.post(`${base}/qr`, JSON.stringify({ tripId }), { headers, tags: { rf: 'RF8.2' } });
    valid(created, 'RF8.2 genera QR', 201, (result) => Boolean(result.json('token')));
    if (created.status === 201) {
      const body = JSON.stringify({ tripId, token: created.json('token') });
      const key = operationId(tripId);
      valid(http.post(`${base}/qr/validate`, body, {
        headers: { ...headers, 'Idempotency-Key': key }, tags: { rf: 'RF8.2' },
      }), 'RF8.2 valida QR', 200, (result) => result.json('valid') === true);
    }
  } else if (selected === 'receipts') {
    valid(http.get(`${base}/api/v1/receipts/${data.tripId}/pdf`, {
      headers: { Authorization: 'Bearer e2e-operator' }, tags: { rf: 'RF8.3' },
    }), 'RF8.3 descarga PDF', 200, (result) => result.headers['Content-Type']?.includes('application/pdf'));
  } else if (selected === 'resend') {
    valid(http.get(`${base}/internal/receipts/${data.tripId}/delivery-reference`, {
      headers: { Authorization: 'Bearer e2e-operator' }, tags: { rf: 'RF8.4' },
    }), 'RF8.4 referencia de entrega', 200);
  } else if (selected === 'delivery') {
    valid(http.get(`${base}/devices/tokens`, {
      headers: { Authorization: bearerToken() }, tags: { rf: 'RF8.7' },
    }), 'RF8.7 consulta tokens', 200);
  }
  sleep(0.2);
}

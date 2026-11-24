import http from 'k6/http';
import { check, sleep } from 'k6';
import { scenario } from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';

const rates = [1, 3, 10, 20, 30, 50];
const rate = Number(__ENV.LAMBDA || '1');
const duration = __ENV.DURACION || '5m';
const baseUrl = (__ENV.BASE_URL || 'http://host.docker.internal:8083').replace(/\/$/, '');
const timeoutMs = 15000;

if (!rates.includes(rate)) {
  throw new Error('LAMBDA debe ser 1, 3, 10, 20, 30 o 50 documentos/minuto.');
}

const received = new Counter('documentos_recibidos');
const processed = new Counter('documentos_procesados');
const pending = new Counter('documentos_pendientes_al_timeout');
const approved = new Counter('documentos_aprobados');
const declined = new Counter('documentos_rechazados');
const errors = new Counter('errores_documentales');
const postTime = new Trend('registro_http_ms', true);
const validationTime = new Trend('validacion_observada_ms', true);

export const options = {
  scenarios: {
    validacion_documental: {
      executor: 'constant-arrival-rate',
      rate,
      timeUnit: '1m',
      duration,
      preAllocatedVUs: 25,
      gracefulStop: '25s',
    },
  },
  thresholds: {
    dropped_iterations: ['count==0'],
    errores_documentales: ['count==0'],
    documentos_pendientes_al_timeout: ['count==0'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'max'],
};

export function setup() {
  const run = Date.now().toString(36);
  const expires = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  // La API documental admite IDs numéricos de prueba, igual que las pruebas E2E.
  const driverBase = 1500000000 + Math.floor(Math.random() * 400000000);
  return { run, expires, driverBase };
}

export default function ({ run, expires, driverBase }) {
  const iteration = scenario.iterationInTest;
  const driverId = driverBase + iteration % 5;
  const url = `${baseUrl}/api/v1/drivers/${driverId}/documents`;
  const number = `K6-${run}-${iteration}`;
  const startedAt = Date.now();
  const response = http.post(url, JSON.stringify({
    tipoDocumento: 'LICENCIA_CONDUCIR',
    numeroDocumento: number,
    fechaVencimiento: expires,
    archivoUrl: 'https://example.invalid/licencia.pdf',
    cara: 'FRENTE',
  }), {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': number },
    tags: { name: 'POST /api/v1/drivers/:driverId/documents' },
    timeout: '5s',
  });
  postTime.add(response.timings.duration);

  const id = response.status === 201 ? jsonField(response, 'id') : null;
  const registered = check(response, { 'registro devuelve 201 e ID': () => typeof id === 'string' && !!id });
  received.add(Number(registered));
  if (!registered) {
    errors.add(1);
    return;
  }

  // El GET detecta el primer estado terminal visible para un cliente.
  const deadline = Date.now() + timeoutMs;
  const documentUrl = `${url}/${encodeURIComponent(id)}`;
  while (Date.now() < deadline) {
    const status = http.get(documentUrl, {
      tags: { name: 'GET /api/v1/drivers/:driverId/documents/:documentId' },
      timeout: '2s',
    });
    const state = status.status === 200 ? jsonField(status, 'estado') : null;
    if (state === 'APROBADO' || state === 'RECHAZADO') {
      processed.add(1);
      approved.add(Number(state === 'APROBADO'));
      declined.add(Number(state === 'RECHAZADO'));
      pending.add(0);
      errors.add(0);
      validationTime.add(Date.now() - startedAt);
      return;
    }
    if (state !== 'PENDIENTE') {
      errors.add(1);
      return;
    }
    sleep(0.25);
  }
  pending.add(1);
  errors.add(0);
}

function jsonField(response, field) {
  try {
    return response.json(field);
  } catch {
    return null;
  }
}

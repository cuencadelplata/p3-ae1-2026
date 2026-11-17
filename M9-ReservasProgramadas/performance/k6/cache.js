// Caché frío vs caliente sobre un conjunto CONTROLADO de reservas, sin FLUSHALL ni endpoints
// para limpiar caché: el setup crea las reservas (POST las deja en caché) y espera a que
// venza el TTL de Redis (REDIS_CACHE_TTL_SECONDS, 60 s por defecto). Luego:
//   fase cold : una lectura por reserva -> cache miss -> PostgreSQL (y repuebla la caché)
//   fase warm : lecturas repetidas      -> cache hit
// Comparar http_req_duration{phase:cold} vs {phase:warm} y m9_cache_requests_total{result}.
import { sleep } from 'k6';
import http from 'k6/http';

import { obtener, crear } from './lib/api.js';
import { BASE_URL, cloudOptions, num, reservaPayload, testTags } from './lib/config.js';
import { buildSummary } from './lib/summary.js';

const SET_SIZE = num('CACHE_SET_SIZE', 20);
const TTL = num('CACHE_TTL_SECONDS', 60);

export const options = {
  setupTimeout: `${TTL + 120}s`,
  scenarios: {
    cold: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      exec: 'cold',
      tags: { phase: 'cold' },
    },
    warm: {
      executor: 'constant-vus',
      vus: num('VUS', 5),
      duration: __ENV.PROFILE === 'short' ? '20s' : '45s',
      startTime: '15s',
      exec: 'warm',
      tags: { phase: 'warm' },
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    m9_unexpected_errors: ['rate<0.01'],
    'http_req_duration{phase:warm}': ['p(95)<300'],
  },
  tags: testTags('cache'),
  cloud: cloudOptions('caché frío/caliente'),
};

export function setup() {
  const ids = [];
  for (let index = 0; index < SET_SIZE; index += 1) {
    const reserva = crear(reservaPayload(900_000 + index));
    if (reserva !== null) ids.push(reserva.id);
  }
  // Espera el vencimiento del TTL para que la fase cold sea realmente fría.
  http.get(`${BASE_URL}/health`, { tags: { name: 'GET /health', op: 'health' } });
  sleep(TTL + 5);
  return { ids };
}

export function cold(data) {
  for (const id of data.ids) obtener(id, 'GET /reservas/:id (cold)', 'get');
}

export function warm(data) {
  obtener(data.ids[__ITER % data.ids.length], 'GET /reservas/:id (warm)', 'get');
  sleep(0.1);
}

export const handleSummary = buildSummary('cache');

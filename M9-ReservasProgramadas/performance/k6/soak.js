// Resistencia: dataset acotado, misma mezcla durante 15 minutos y lectura final.
import { check, fail, sleep } from 'k6';
import { crear, obtener } from './lib/api.js';
import { cloudOptions, duration, num, reservaPayload, testTags } from './lib/config.js';
import { positiveInt } from './lib/capacity-plan.js';
import { steadyWorkload } from './lib/steady-workload.js';
import { buildSummary } from './lib/summary.js';

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: positiveInt(__ENV.VUS, 15, 'VUS'),
      duration: duration('15m', '1m'),
      gracefulStop: '15s',
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'],
  thresholds: {
    checks: ['rate>0.99'],
    m9_unexpected_errors: ['rate<0.01'],
    m9_pricing_degraded: ['rate<0.01'],
    'http_req_duration{op:get}': ['p(95)<500'],
    'http_req_duration{op:update}': ['p(95)<500'],
    'http_req_duration{op:list}': ['p(95)<800'],
  },
  tags: testTags('soak'),
  cloud: cloudOptions('resistencia sostenida'),
};
export function setup() {
  const seed = crear(reservaPayload(730_000));
  if (seed === null) fail('M9 no supera la verificación previa');
  return { id: seed.id };
}
export default function () {
  steadyWorkload();
  sleep(num('THINK_TIME_SECONDS', 0.2));
}
export function teardown(data) {
  const reserva = obtener(data.id);
  check(reserva, {
    'resistencia: reserva inicial sigue almacenada': (body) => body?.estado === 'PROGRAMADA',
  });
}
export const handleSummary = buildSummary('soak');

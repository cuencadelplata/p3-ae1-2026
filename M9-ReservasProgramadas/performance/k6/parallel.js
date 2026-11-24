// VUs concurrentes + http.batch: cada VU envía un lote simultáneo por operación.
// Las fases se esperan entre sí: nunca se consulta una reserva antes de crearla.
import { fail, sleep } from 'k6';
import { Trend } from 'k6/metrics';

import { batchReservas } from './lib/api.js';
import {
  BASE_THRESHOLDS,
  cloudOptions,
  duration,
  futureIso,
  num,
  reservaPayload,
  testTags,
} from './lib/config.js';
import { positiveInt } from './lib/capacity-plan.js';
import { buildSummary } from './lib/summary.js';

const SIZE = positiveInt(__ENV.BATCH_SIZE, 5, 'BATCH_SIZE');
const VUS = positiveInt(__ENV.VUS, 10, 'VUS');
const batchDuration = new Trend('m9_batch_duration', true);
export const options = {
  batch: SIZE,
  batchPerHost: SIZE,
  scenarios: { parallel: { executor: 'constant-vus', vus: VUS, duration: duration('2m', '30s') } },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'],
  thresholds: { ...BASE_THRESHOLDS, m9_pricing_degraded: ['rate<0.01'] },
  tags: testTags('parallel'),
  cloud: cloudOptions('solicitudes simultáneas'),
};

export function setup() {
  // Una falla de conectividad/configuración no se confunde con un límite de capacidad.
  const seed = batchReservas([{ method: 'POST', body: reservaPayload(710_000) }]);
  if (seed.length !== 1 || seed[0] === null) fail('No se pudo crear la reserva de control');
  batchReservas([{ method: 'DELETE', id: seed[0].id }]);
}

export default function () {
  const run = (requests, phase) => {
    const start = Date.now();
    const responses = batchReservas(requests, { phase });
    batchDuration.add(Date.now() - start, { phase });
    return responses;
  };
  const created = run(
    Array.from({ length: SIZE }, (_, i) => ({
      method: 'POST',
      body: reservaPayload(__VU * 1_000_000 + __ITER * SIZE + i),
    })),
    'create',
  ).filter((body) => body !== null);
  if (created.length === 0) return;
  run(
    created.map(({ id }) => ({ method: 'GET', id })),
    'get',
  );
  run([{ method: 'GET' }], 'list');
  run(
    created.map(({ id }) => ({
      method: 'PATCH',
      id,
      body: { fechaHoraProgramada: futureIso(3 * 24 * 60) },
    })),
    'update_schedule',
  );
  run(
    created.map(({ id, vehiculo }) => ({
      method: 'PATCH',
      id,
      body: {
        destino: `Destino paralelo ${__VU}-${__ITER}`,
        vehiculo: vehiculo === 'AUTO' ? 'MOTO' : 'AUTO',
      },
    })),
    'update_reprice',
  );
  run(
    created.map(({ id }) => ({ method: 'DELETE', id })),
    'cancel',
  );
  sleep(num('THINK_TIME_SECONDS', 0.5));
}

export const handleSummary = buildSummary('parallel');

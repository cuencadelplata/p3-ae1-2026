// Estrés: busca el punto donde se incumplen los umbrales y observa la recuperación.
// No se fuerza que todos los escalones aprueben: un FAIL es un resultado válido y se guarda.
//
//   MODE=vus (defecto)  ramping-vus 5 -> 10 -> 25 -> 50, sostenimiento y descenso.
//   MODE=arrival        ramping-arrival-rate con RPS objetivo; informar dropped_iterations
//                       (iteraciones que el generador no pudo lanzar: límite del generador).
import { sleep } from 'k6';

import {
  actualizar,
  cancelar,
  conflictive,
  crear,
  listar,
  obtener,
  verificarIdempotenciaCancelacion,
} from './lib/api.js';
import {
  BASE_THRESHOLDS,
  cloudOptions,
  duration,
  futureIso,
  num,
  reservaPayload,
  testTags,
} from './lib/config.js';
import { buildSummary } from './lib/summary.js';
import { positiveInt } from './lib/capacity-plan.js';

const STAGE = duration('1m', '30s');
const steps = (__ENV.STRESS_STEPS || '5,10,25,50')
  .split(',')
  .map((value) => positiveInt(value.trim(), undefined, 'STRESS_STEPS'));
if (__ENV.MODE && !['vus', 'arrival'].includes(__ENV.MODE))
  throw new Error('MODE debe ser vus o arrival');

const vuScenario = {
  executor: 'ramping-vus',
  startVUs: 0,
  stages: [
    ...steps.flatMap((target) => [
      { duration: STAGE, target },
      { duration: STAGE, target },
    ]),
    { duration: '10s', target: steps[0] },
    { duration: STAGE, target: steps[0] }, // recuperación con tráfico real
  ],
  gracefulRampDown: '10s',
};

const rates = (__ENV.STRESS_RPS || '10,25,50,100')
  .split(',')
  .map((value) => positiveInt(value.trim(), undefined, 'STRESS_RPS'));
const arrivalScenario = {
  executor: 'ramping-arrival-rate',
  startRate: rates[0],
  timeUnit: '1s',
  preAllocatedVUs: num('PRE_ALLOCATED_VUS', 20),
  maxVUs: num('MAX_VUS', 100),
  stages: [
    ...rates.flatMap((target) => [
      { duration: STAGE, target },
      { duration: STAGE, target },
    ]),
    { duration: '10s', target: rates[0] },
    { duration: STAGE, target: rates[0] },
  ],
};

export const options = {
  scenarios: { stress: __ENV.MODE === 'arrival' ? arrivalScenario : vuScenario },
  // Los umbrales no abortan la prueba: se quiere ver el incumplimiento y la recuperación.
  thresholds: {
    ...BASE_THRESHOLDS,
    m9_pricing_degraded: ['rate<0.01'],
    ...(__ENV.MODE === 'arrival' ? { dropped_iterations: ['count==0'] } : {}),
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'],
  tags: testTags(__ENV.MODE === 'arrival' ? 'stress-arrival' : 'stress'),
  cloud: cloudOptions(__ENV.MODE === 'arrival' ? 'estrés por tasa' : 'estrés por VUs'),
};

export function setup() {
  const sharedIds = [];
  for (let index = 0; index < 4; index += 1) {
    const reserva = crear(reservaPayload(600_000 + index));
    if (reserva !== null) sharedIds.push(reserva.id);
  }
  return { sharedIds };
}

const own = [];
let created = 0;

export default function (data) {
  const sharedIds = data?.sharedIds ?? [];
  const slot = (__ITER + __VU) % 12;
  if (slot < 3 || own.length === 0) {
    const reserva = crear(reservaPayload(__VU * 100_000 + created++));
    if (reserva !== null) own.push(reserva.id);
  } else if (slot < 7) {
    obtener(own[__ITER % own.length]);
  } else if (slot === 7) {
    listar((__ITER % 4) + 1, 20);
  } else if (slot === 8) {
    const id = own[__ITER % own.length];
    actualizar(id, {
      destino: `Destino stress ${(__ITER + __VU) % 50}`,
      vehiculo: __ITER % 2 === 0 ? 'MOTO' : 'AUTO',
    });
  } else if (slot === 9 && sharedIds.length > 0) {
    const sharedId = sharedIds[(__ITER + __VU) % sharedIds.length];
    conflictive('PATCH', sharedId, {
      fechaHoraProgramada: futureIso(2 * 24 * 60 + ((__ITER + __VU) % 300)),
    });
  } else if (slot === 10 && own.length > 1) {
    const id = own.pop();
    if (id !== undefined && cancelar(id) !== null && __ITER % 3 === 0) {
      verificarIdempotenciaCancelacion(id);
    }
  } else {
    obtener(own[__ITER % own.length]);
  }
  if (__ENV.MODE !== 'arrival') sleep(num('THINK_TIME_SECONDS', 0.3));
}

export const handleSummary = buildSummary(__ENV.MODE === 'arrival' ? 'stress-arrival' : 'stress');

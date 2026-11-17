// Estrés: busca el punto donde se incumplen los umbrales y observa la recuperación.
// No se fuerza que todos los escalones aprueben: un FAIL es un resultado válido y se guarda.
//
//   MODE=vus (defecto)  ramping-vus 5 -> 10 -> 25 -> 50, sostenimiento y descenso.
//   MODE=arrival        ramping-arrival-rate con RPS objetivo; informar dropped_iterations
//                       (iteraciones que el generador no pudo lanzar: límite del generador).
import { sleep } from 'k6';

import { crear, listar, obtener } from './lib/api.js';
import {
  BASE_THRESHOLDS,
  cloudOptions,
  duration,
  num,
  reservaPayload,
  testTags,
} from './lib/config.js';
import { buildSummary } from './lib/summary.js';

const STAGE = duration('1m', '30s');
const steps = (__ENV.STRESS_STEPS || '5,10,25,50').split(',').map(Number);

const vuScenario = {
  executor: 'ramping-vus',
  startVUs: 0,
  stages: [
    ...steps.map((target) => ({ duration: STAGE, target })),
    { duration: STAGE, target: steps[steps.length - 1] }, // sostenimiento
    { duration: STAGE, target: 0 }, // descenso / recuperación
  ],
  gracefulRampDown: '10s',
};

const rates = (__ENV.STRESS_RPS || '10,25,50,100').split(',').map(Number);
const arrivalScenario = {
  executor: 'ramping-arrival-rate',
  startRate: rates[0],
  timeUnit: '1s',
  preAllocatedVUs: num('PRE_ALLOCATED_VUS', 20),
  maxVUs: num('MAX_VUS', 100),
  stages: [...rates.map((target) => ({ duration: STAGE, target })), { duration: STAGE, target: 0 }],
};

export const options = {
  scenarios: { stress: __ENV.MODE === 'arrival' ? arrivalScenario : vuScenario },
  // Los umbrales no abortan la prueba: se quiere ver el incumplimiento y la recuperación.
  thresholds: BASE_THRESHOLDS,
  tags: testTags(__ENV.MODE === 'arrival' ? 'stress-arrival' : 'stress'),
  cloud: cloudOptions(__ENV.MODE === 'arrival' ? 'estrés por tasa' : 'estrés por VUs'),
};

const own = [];
let created = 0;

export default function () {
  // Mezcla simplificada 70/30: lecturas dominantes, creación como escritura principal.
  const slot = (__ITER + __VU) % 10;
  if (slot < 3 || own.length === 0) {
    const reserva = crear(reservaPayload(__VU * 100_000 + created++));
    if (reserva !== null) own.push(reserva.id);
  } else if (slot < 9) {
    obtener(own[__ITER % own.length]);
  } else {
    listar();
  }
  if (__ENV.MODE !== 'arrival') sleep(num('THINK_TIME_SECONDS', 0.3));
}

export const handleSummary = buildSummary(__ENV.MODE === 'arrival' ? 'stress-arrival' : 'stress');

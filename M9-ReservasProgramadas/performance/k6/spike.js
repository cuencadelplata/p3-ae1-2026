// Pico: carga base, aumento brusco y breve (SPIKE_VUS), vuelta a la base y recuperación.
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
  futureIso,
  num,
  reservaPayload,
  testTags,
} from './lib/config.js';
import { buildSummary } from './lib/summary.js';

const BASE = num('BASE_VUS', 5);
const SPIKE = num('SPIKE_VUS', 50);
const short = __ENV.PROFILE === 'short';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: BASE,
      stages: [
        { duration: short ? '20s' : '1m', target: BASE }, // línea base
        { duration: '10s', target: SPIKE }, // subida brusca
        { duration: short ? '20s' : '30s', target: SPIKE }, // pico breve
        { duration: '10s', target: BASE }, // bajada
        { duration: short ? '30s' : '1m', target: BASE }, // recuperación observable
      ],
    },
  },
  thresholds: BASE_THRESHOLDS,
  tags: testTags('spike'),
  cloud: cloudOptions('pico'),
};

export function setup() {
  const sharedIds = [];
  for (let index = 0; index < 3; index += 1) {
    const reserva = crear(reservaPayload(650_000 + index));
    if (reserva !== null) sharedIds.push(reserva.id);
  }
  return { sharedIds };
}

const own = [];
let created = 0;

export default function (data) {
  const sharedIds = data?.sharedIds ?? [];
  const step = (__ITER + __VU) % 8;
  if (own.length === 0 || step < 2) {
    const reserva = crear(reservaPayload(__VU * 100_000 + created++));
    if (reserva !== null) own.push(reserva.id);
  } else if (step < 5) {
    obtener(own[__ITER % own.length]);
  } else if (step === 5) {
    actualizar(own[__ITER % own.length], {
      vehiculo: __ITER % 2 === 0 ? 'MOTO' : 'AUTO',
      fechaHoraProgramada: futureIso(2 * 24 * 60 + (__ITER % 240)),
    });
  } else if (step === 6 && sharedIds.length > 0) {
    conflictive('PATCH', sharedIds[(__ITER + __VU) % sharedIds.length], {
      fechaHoraProgramada: futureIso(2 * 24 * 60 + ((__ITER + __VU) % 240)),
    });
  } else if (own.length > 1) {
    const id = own.pop();
    if (id !== undefined && cancelar(id) !== null && __ITER % 4 === 0) {
      verificarIdempotenciaCancelacion(id);
    }
  } else {
    listar(1, 20);
  }
  sleep(num('THINK_TIME_SECONDS', 0.3));
}

export const handleSummary = buildSummary('spike');

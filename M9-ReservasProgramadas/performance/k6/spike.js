// Pico: carga base, aumento brusco y breve (SPIKE_VUS), vuelta a la base y recuperación.
import { sleep } from 'k6';

import { crear, obtener } from './lib/api.js';
import { BASE_THRESHOLDS, cloudOptions, num, reservaPayload, testTags } from './lib/config.js';
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

const own = [];
let created = 0;

export default function () {
  if (own.length === 0 || __ITER % 4 === 0) {
    const reserva = crear(reservaPayload(__VU * 100_000 + created++));
    if (reserva !== null) own.push(reserva.id);
  } else {
    obtener(own[__ITER % own.length]);
  }
  sleep(num('THINK_TIME_SECONDS', 0.3));
}

export const handleSummary = buildSummary('spike');

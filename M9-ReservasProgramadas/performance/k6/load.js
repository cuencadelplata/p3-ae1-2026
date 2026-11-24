// Carga de referencia: mezcla reproducible de lecturas, escrituras, recotización M7,
// paginación, contención sobre reservas compartidas y verificación de idempotencia.
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

// 20 posiciones = 5 % cada una. Orden fijo -> secuencia determinista por VU/iteración.
const MIX = [
  'get',
  'get',
  'get',
  'get',
  'get',
  'get',
  'get',
  'get',
  'get',
  'get',
  'list',
  'list',
  'list',
  'create',
  'create',
  'create',
  'update_schedule',
  'update_reprice',
  'shared_lock',
  'cancel',
];

const SHARED_POOL = num('SHARED_RESERVATIONS', 5);
const PAGE_SIZES = [10, 20, 50];

export const options = {
  scenarios: {
    load: {
      executor: 'constant-vus',
      vus: num('VUS', 10),
      duration: duration('3m', '1m'),
    },
  },
  thresholds: BASE_THRESHOLDS,
  tags: testTags('load'),
  cloud: cloudOptions('carga de referencia'),
};

export function setup() {
  const sharedIds = [];
  for (let index = 0; index < SHARED_POOL; index += 1) {
    const reserva = crear(reservaPayload(500_000 + index));
    if (reserva !== null) sharedIds.push(reserva.id);
  }
  return { sharedIds };
}

const own = []; // reservas PROGRAMADA creadas por este VU
let created = 0;

const ensureOwn = () => {
  if (own.length > 0) return own[own.length - 1];
  const reserva = crear(reservaPayload(__VU * 100_000 + created++));
  if (reserva !== null) own.push(reserva.id);
  return reserva?.id ?? null;
};

export default function (data) {
  const op = MIX[(__ITER * 7 + __VU) % MIX.length];
  const sharedIds = data?.sharedIds ?? [];

  if (op === 'create') {
    const reserva = crear(reservaPayload(__VU * 100_000 + created++));
    if (reserva !== null) own.push(reserva.id);
  } else if (op === 'list') {
    const page = (__ITER % 5) + 1;
    const pageSize = PAGE_SIZES[__ITER % PAGE_SIZES.length];
    listar(page, pageSize);
  } else if (op === 'get') {
    if (sharedIds.length > 0 && __ITER % 3 === 0) {
      obtener(sharedIds[(__ITER + __VU) % sharedIds.length]);
    } else {
      const id = ensureOwn();
      if (id !== null) obtener(own[__ITER % own.length] ?? id);
    }
  } else if (op === 'update_schedule') {
    const id = ensureOwn();
    if (id !== null)
      actualizar(id, { fechaHoraProgramada: futureIso(2 * 24 * 60 + (__ITER % 600)) });
  } else if (op === 'update_reprice') {
    const id = ensureOwn();
    if (id !== null) {
      actualizar(id, {
        destino: `Destino carga ${(__ITER + __VU) % 70}`,
        vehiculo: __ITER % 2 === 0 ? 'MOTO' : 'AUTO',
      });
    }
  } else if (op === 'shared_lock') {
    if (sharedIds.length > 0) {
      const targetId = sharedIds[(__ITER + __VU) % sharedIds.length];
      conflictive('PATCH', targetId, {
        fechaHoraProgramada: futureIso(2 * 24 * 60 + ((__ITER + __VU) % 400)),
      });
    }
  } else {
    const id = ensureOwn();
    if (id !== null && cancelar(id) !== null) {
      own.splice(own.indexOf(id), 1);
      if (__ITER % 2 === 0) verificarIdempotenciaCancelacion(id);
    }
  }
  sleep(num('THINK_TIME_SECONDS', 0.5));
}

export const handleSummary = buildSummary('load');

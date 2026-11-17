// Carga de referencia: mezcla reproducible 70 % lecturas / 30 % escrituras.
//   GET /reservas/:id 55 % · GET /reservas 15 % · POST 15 % · PATCH 10 % · DELETE 5 %
// Cada VU trabaja con SUS propias reservas: las escrituras no chocan artificialmente.
// Aviso: GET /reservas no tiene paginación y CANCELADA persiste, así que el listado crece
// durante la prueba; su latencia se informa por separado (op:list).
import { sleep } from 'k6';

import { actualizar, cancelar, crear, listar, obtener } from './lib/api.js';
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
  'get',
  'list',
  'list',
  'list',
  'create',
  'create',
  'create',
  'update',
  'update',
  'cancel',
];

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

const own = []; // reservas PROGRAMADA creadas por este VU
let created = 0;

const ensureOwn = () => {
  if (own.length > 0) return own[own.length - 1];
  const reserva = crear(reservaPayload(__VU * 100_000 + created++));
  if (reserva !== null) own.push(reserva.id);
  return reserva?.id ?? null;
};

export default function () {
  const op = MIX[(__ITER * 7 + __VU) % MIX.length];
  if (op === 'create') {
    const reserva = crear(reservaPayload(__VU * 100_000 + created++));
    if (reserva !== null) own.push(reserva.id);
  } else if (op === 'list') {
    listar();
  } else if (op === 'get') {
    const id = ensureOwn();
    if (id !== null) obtener(own[__ITER % own.length] ?? id);
  } else if (op === 'update') {
    const id = ensureOwn();
    if (id !== null)
      actualizar(id, { fechaHoraProgramada: futureIso(2 * 24 * 60 + (__ITER % 600)) });
  } else {
    const id = ensureOwn();
    if (id !== null && cancelar(id) !== null) own.splice(own.indexOf(id), 1);
  }
  sleep(num('THINK_TIME_SECONDS', 0.5));
}

export const handleSummary = buildSummary('load');

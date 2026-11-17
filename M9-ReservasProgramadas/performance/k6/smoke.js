// Smoke: 1–2 VUs ~30 s. CRUD válido completo con verificación de respuestas y efectos.
import { check, sleep } from 'k6';

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

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: num('VUS', 2),
      duration: duration('30s', '30s'),
    },
  },
  thresholds: BASE_THRESHOLDS,
  tags: testTags('smoke'),
  cloud: cloudOptions('smoke'),
};

export default function () {
  const index = __VU * 10_000 + __ITER;
  const creada = crear(reservaPayload(index));
  if (creada === null) return;

  obtener(creada.id);
  listar();

  const nuevaFecha = futureIso(3 * 24 * 60);
  const actualizada = actualizar(creada.id, { fechaHoraProgramada: nuevaFecha });
  check(actualizada, {
    'smoke: sigue PROGRAMADA tras modificar': (r) => r?.estado === 'PROGRAMADA',
  });

  cancelar(creada.id);
  const final = obtener(creada.id);
  check(final, { 'smoke: CANCELADA persiste (borrado lógico)': (r) => r?.estado === 'CANCELADA' });
  sleep(1);
}

export const handleSummary = buildSummary('smoke');

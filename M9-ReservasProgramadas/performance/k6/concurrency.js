// Concurrencia: muchos VUs modifican y cancelan las MISMAS reservas a la vez.
// 409 es esperado SOLO en este escenario (locks Redis / transiciones condicionales) y se
// cuenta aparte en m9_expected_conflicts. Cualquier otro status != 200 es inesperado.
// Invariantes verificadas en teardown:
//   1) cada reserva compartida termina en PROGRAMADA o CANCELADA (nunca otro estado);
//   2) una reserva CANCELADA no se puede volver a cancelar (409 RESERVA_NO_CANCELABLE).
import { check, fail } from 'k6';
import http from 'k6/http';

import { conflictive, crear, parse } from './lib/api.js';
import { BASE_URL, cloudOptions, futureIso, num, reservaPayload, testTags } from './lib/config.js';
import { buildSummary } from './lib/summary.js';

const SHARED = num('SHARED_RESERVATIONS', 3);

export const options = {
  scenarios: {
    contention: {
      executor: 'shared-iterations',
      vus: num('VUS', 20),
      iterations: num('ITERATIONS', 200),
      maxDuration: '2m',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    m9_unexpected_errors: ['rate<0.01'],
  },
  tags: testTags('concurrency'),
  cloud: cloudOptions('concurrencia'),
};

export function setup() {
  const ids = [];
  for (let index = 0; index < SHARED; index += 1) {
    const reserva = crear(reservaPayload(800_000 + index));
    if (reserva !== null) ids.push(reserva.id);
  }
  if (ids.length !== SHARED) fail('No se pudo crear el conjunto completo de reservas compartidas');
  return { ids };
}

export default function (data) {
  const id = data.ids[__ITER % data.ids.length];
  // Combina modificaciones de horario, recotizaciones de vehículo/destino en M7 bajo lock
  // y cancelaciones concurrentes sobre las mismas reservas compartidas.
  const mod = __ITER % 12;
  if (mod === 11) {
    conflictive('DELETE', id);
  } else if (mod % 3 === 0) {
    conflictive('PATCH', id, {
      destino: `Destino concurrente ${(__ITER + __VU) % 40}`,
      vehiculo: __ITER % 2 === 0 ? 'MOTO' : 'AUTO',
    });
  } else {
    conflictive('PATCH', id, { fechaHoraProgramada: futureIso(2 * 24 * 60 + (__ITER % 300)) });
  }
}

export function teardown(data) {
  for (const id of data.ids) {
    const response = http.get(`${BASE_URL}/reservas/${id}`, {
      tags: { name: 'GET /reservas/:id (invariante)', op: 'invariant' },
    });
    const estado = parse(response)?.estado;
    check(estado, {
      'invariante: estado final PROGRAMADA o CANCELADA': (value) =>
        value === 'PROGRAMADA' || value === 'CANCELADA',
    });
    if (estado === 'CANCELADA') {
      const again = http.del(`${BASE_URL}/reservas/${id}`, null, {
        tags: { name: 'DELETE /reservas/:id (invariante)', op: 'invariant' },
        responseCallback: http.expectedStatuses(409),
      });
      check(again, {
        'invariante: no se cancela dos veces (409)': (r) =>
          r.status === 409 && parse(r)?.error?.codigo === 'RESERVA_NO_CANCELABLE',
      });
    }
  }
}

export const handleSummary = buildSummary('concurrency');

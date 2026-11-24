// Despacho e integración real M9 -> M7 -> Scheduler -> M5 + concurrencia e idempotencia.
// A diferencia de activation.js (que requiere m5-stub para llegar a ACTIVADA por eventos),
// este escenario funciona contra M5 y M7 REALES:
//   1) Crea múltiples reservas con horario próximo (LEAD segundos) y verifica cotización en M7.
//   2) Espera a que el scheduler reclame la reserva y cree el RideRequest en M5 con Idempotency-Key
//      (estado ACTIVANDO con idSolicitud != null, o ACTIVADA si hay asignación).
//   3) Comprueba invariantes de concurrencia/estado: un PATCH en ACTIVANDO devuelve 409.
//   4) Cancela la reserva en ACTIVANDO (propagando cancelación a M5 real) y verifica idempotencia
//      con un segundo DELETE (409 RESERVA_NO_CANCELABLE), liberando al cliente para la siguiente reserva.
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

import {
  cancelar,
  conflictive,
  crear,
  obtener,
  verificarIdempotenciaCancelacion,
} from './lib/api.js';
import { cloudOptions, futureIsoSeconds, num, reservaPayload, testTags } from './lib/config.js';
import { buildSummary } from './lib/summary.js';

const dispatchClaimSeconds = new Trend('m9_dispatch_claim_seconds');
const dispatchSuccess = new Rate('m9_dispatch_success');
const dispatchTimeouts = new Counter('m9_dispatch_timeouts');

const LEAD = num('ACTIVATION_LEAD_SECONDS', 8);
const TIMEOUT = num('ACTIVATION_TIMEOUT_SECONDS', 45);
const POLL = num('POLL_INTERVAL_SECONDS', 1.5);

export const options = {
  scenarios: {
    dispatch: {
      executor: 'per-vu-iterations',
      vus: num('VUS', 1),
      iterations: num('ITERATIONS', 3),
      maxDuration: `${(LEAD + TIMEOUT + 25) * num('ITERATIONS', 3)}s`,
    },
  },
  thresholds: {
    checks: ['rate>0.95'],
    m9_dispatch_timeouts: ['count<1'],
    m9_dispatch_success: ['rate>0.95'],
    m9_dispatch_claim_seconds: ['p(95)<40'],
  },
  tags: testTags('dispatch'),
  cloud: cloudOptions('despacho e idempotencia M5/M7'),
};

export default function () {
  const index = 750_000 + __VU * 100 + __ITER;
  const scheduledAt = futureIsoSeconds(LEAD);
  const reserva = crear(reservaPayload(index, scheduledAt));
  if (reserva === null) return;

  check(reserva, {
    'dispatch: M7 calculó tarifaEstimada > 0': (r) =>
      typeof r.tarifaEstimada === 'number' && r.tarifaEstimada > 0,
  });

  sleep(LEAD);
  const deadline = Date.now() + TIMEOUT * 1000;
  let actual = reserva;
  while (Date.now() < deadline) {
    actual = obtener(reserva.id, 'GET /reservas/:id (poll)', 'poll') ?? actual;
    if (
      (actual.estado === 'ACTIVANDO' && actual.idSolicitud !== null) ||
      actual.estado === 'ACTIVADA' ||
      actual.estado === 'FALLIDA'
    ) {
      break;
    }
    sleep(POLL);
  }

  const dispatched =
    (actual.estado === 'ACTIVANDO' && actual.idSolicitud !== null) || actual.estado === 'ACTIVADA';

  if (dispatched) {
    dispatchClaimSeconds.add(Math.max(0, (Date.now() - Date.parse(scheduledAt)) / 1000));
    dispatchSuccess.add(true);
  } else {
    dispatchSuccess.add(false);
    dispatchTimeouts.add(1);
  }

  check(actual, {
    'dispatch: M9 registró idSolicitud de M5': (r) =>
      typeof r?.idSolicitud === 'string' && r.idSolicitud.length > 0,
  });

  if (actual.estado === 'ACTIVANDO' && actual.idSolicitud !== null) {
    // Mientras está ACTIVANDO, un PATCH concurrente debe rechazarse con 409 RESERVA_NO_MODIFICABLE
    const patchRes = conflictive('PATCH', reserva.id, { destino: 'Intento en ACTIVANDO' });
    check(patchRes, {
      'dispatch: PATCH en ACTIVANDO rechazado con 409': (r) => r.status === 409,
    });

    // Cancelar propaga la cancelación hacia M5 real y pasa a CANCELADA
    const cancelada = cancelar(reserva.id);
    check(cancelada, {
      'dispatch: cancelación M9 -> M5 completada': (r) => r?.estado === 'CANCELADA',
    });

    // Verificar idempotencia: repetir DELETE y PATCH sobre la reserva ya cancelada devuelve 409
    verificarIdempotenciaCancelacion(reserva.id);
  }
}

export const handleSummary = buildSummary('dispatch');

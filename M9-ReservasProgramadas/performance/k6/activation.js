// Activación asíncrona extremo a extremo (scheduler -> Outbox -> RabbitMQ -> m5-stub -> Inbox).
// Crea reservas con fecha muy próxima, espera su vencimiento y consulta con polling ACOTADO
// hasta ACTIVADA/FALLIDA. Se miden por separado:
//   - latencia HTTP de creación (op:create) y de polling (op:poll)
//   - m9_activation_resolution_seconds: desde la fecha programada hasta observar el estado final
//   - m9_activation_success: proporción ACTIVADA sobre resoluciones
// Volumen chico a propósito para que el polling no domine la prueba.
// Timeout por defecto 120 s = scheduler (5 s) + Outbox (5 s) + retries + respuesta de M5,
// con margen. Ajustar ACTIVATION_TIMEOUT_SECONDS si el entorno usa otros intervalos.
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

import { crear, obtener } from './lib/api.js';
import { cloudOptions, futureIsoSeconds, num, reservaPayload, testTags } from './lib/config.js';
import { buildSummary } from './lib/summary.js';

const resolution = new Trend('m9_activation_resolution_seconds');
const success = new Rate('m9_activation_success');
const timeouts = new Counter('m9_activation_timeouts');

const LEAD = num('ACTIVATION_LEAD_SECONDS', 15);
const TIMEOUT = num('ACTIVATION_TIMEOUT_SECONDS', 120);
const POLL = num('POLL_INTERVAL_SECONDS', 2);

export const options = {
  scenarios: {
    activation: {
      executor: 'per-vu-iterations',
      vus: num('VUS', 3),
      iterations: num('ITERATIONS', 2),
      maxDuration: `${(LEAD + TIMEOUT + 30) * num('ITERATIONS', 2)}s`,
    },
  },
  thresholds: {
    checks: ['rate>0.95'],
    m9_activation_timeouts: ['count<1'],
    m9_activation_success: ['rate>0.95'],
    // Hipótesis inicial: con cron de 5 s y Outbox de 5 s, la resolución debería caer en < 60 s.
    m9_activation_resolution_seconds: ['p(95)<60'],
  },
  tags: testTags('activation'),
  cloud: cloudOptions('activación asíncrona'),
};

export default function () {
  const scheduledAt = futureIsoSeconds(LEAD);
  const reserva = crear(reservaPayload(700_000 + __VU * 100 + __ITER, scheduledAt));
  if (reserva === null) return;

  sleep(LEAD);
  const deadline = Date.now() + TIMEOUT * 1000;
  let estado = reserva.estado;
  while (Date.now() < deadline) {
    estado = obtener(reserva.id, 'GET /reservas/:id (poll)', 'poll')?.estado ?? estado;
    if (estado === 'ACTIVADA' || estado === 'FALLIDA') break;
    sleep(POLL);
  }

  if (estado === 'ACTIVADA' || estado === 'FALLIDA') {
    resolution.add((Date.now() - Date.parse(scheduledAt)) / 1000);
    success.add(estado === 'ACTIVADA');
  } else {
    timeouts.add(1);
  }
  check(estado, { 'activación: estado final ACTIVADA': (value) => value === 'ACTIVADA' });
}

export const handleSummary = buildSummary('activation');

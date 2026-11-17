import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// Solo M3 Conductor & Valoraciones.
// Default: puerto publicado de p3-m3-api / m3-conductor-api.
const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:5000';

const latencyConductores = new Trend('latency_conductores_ms', true);
const latencyValoraciones = new Trend('latency_valoraciones_ms', true);
const latencyPostValoracion = new Trend('latency_post_valoracion_ms', true);
const errorRate = new Rate('api_errors');
const requestsConductor = new Counter('requests_conductor');
const requestsValoraciones = new Counter('requests_valoraciones');

export const options = {
  stages: [
    { duration: '20s', target: 10 }, // calentamiento
    { duration: '40s', target: 30 }, // saturación moderada
    { duration: '20s', target: 50 }, // pico
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<800'],
    latency_conductores_ms: ['p(95)<500'],
    latency_valoraciones_ms: ['p(95)<500'],
    latency_post_valoracion_ms: ['p(95)<800'],
    api_errors: ['rate<0.05'],
    http_req_failed: ['rate<0.05'],
  },
};

function hit(method, url, body, trend, counter) {
  const res =
    method === 'POST'
      ? http.post(url, body, {
          headers: { 'Content-Type': 'application/json' },
          tags: { name: url },
        })
      : http.get(url, { tags: { name: url } });

  trend.add(res.timings.duration);
  counter.add(1);
  const ok = check(res, {
    'status 2xx': (r) => r.status >= 200 && r.status < 300,
  });
  errorRate.add(!ok);
  return res;
}

export default function () {
  hit(
    'GET',
    `${BASE_URL}/api/conductores`,
    null,
    latencyConductores,
    requestsConductor
  );

  hit(
    'GET',
    `${BASE_URL}/api/conductor/valoraciones?evaluadorId=cond_001`,
    null,
    latencyValoraciones,
    requestsValoraciones
  );

  hit(
    'POST',
    `${BASE_URL}/api/conductor/valoraciones?evaluadorId=cond_001`,
    JSON.stringify({
      evaluadoId: 'cli_k6',
      valoracion: 4,
      comentario: 'carga k6',
      viajeId: `viaje_k6_${__VU}_${__ITER}`,
    }),
    latencyPostValoracion,
    requestsValoraciones
  );

  sleep(0.5);
}

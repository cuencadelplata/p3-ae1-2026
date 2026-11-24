// Mediciones para Teoría de Colas (modelo M/M/c) sobre la API de viajes de M6.
//
// Cada petición es una solicitud de viaje (POST /api/viajes), la operación con la que
// empieza el ciclo de vida del viaje. Dos modos:
//
//   MODO=capacidad  Modelo cerrado: VUS usuarios virtuales piden viajes sin pausa durante
//                   DURACION. El throughput resultante es la capacidad de servicio μ del
//                   sistema con las instancias levantadas.
//
//   MODO=poisson    Modelo abierto: llegadas aleatorias con tasa media LAMBDA (pedidos/s).
//                   k6 genera "ranuras" a 1000/s y cada una envía un pedido con probabilidad
//                   LAMBDA/1000 (proceso de Bernoulli de paso fino ≈ proceso de Poisson),
//                   que es lo que supone el modelo M/M/c para las llegadas.
//
// Uso:
//   k6 run -e MODO=capacidad -e VUS=64 -e DURACION=30s k6/colas.js
//   k6 run -e MODO=poisson -e LAMBDA=100 -e DURACION=45s k6/colas.js
// Variables opcionales: BASE_URL (por defecto http://localhost:3000), SALIDA (archivo JSON).

import http from 'k6/http';
import { check } from 'k6';

const baseUrl = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const modo = __ENV.MODO || 'poisson';
const duracion = __ENV.DURACION || '45s';
const lambda = Number(__ENV.LAMBDA || 10);
const RANURAS_POR_SEGUNDO = 1000;

export const options = modo === 'capacidad'
  ? {
      scenarios: {
        capacidad: { executor: 'constant-vus', vus: Number(__ENV.VUS || 64), duration: duracion },
      },
      summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
    }
  : {
      scenarios: {
        poisson: {
          executor: 'constant-arrival-rate',
          rate: RANURAS_POR_SEGUNDO,
          timeUnit: '1s',
          duration: duracion,
          preAllocatedVUs: 200,
          maxVUs: 2000,
        },
      },
      summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
    };

export default function () {
  if (modo !== 'capacidad' && Math.random() >= lambda / RANURAS_POR_SEGUNDO) return;

  const respuesta = http.post(
    `${baseUrl}/api/viajes`,
    JSON.stringify({ clienteId: `k6-colas-${__VU}-${__ITER}`, origen: 'Origen k6', destino: 'Destino k6' }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'solicitar_viaje' } },
  );
  check(respuesta, { 'solicitud aceptada (201)': (r) => r.status === 201 });
}

export function handleSummary(data) {
  const m = data.metrics;
  const segundos = data.state.testRunDurationMs / 1000;
  const d = m.http_req_duration.values;
  const resumen = {
    modo,
    lambdaObjetivo: modo === 'capacidad' ? null : lambda,
    vus: modo === 'capacidad' ? Number(__ENV.VUS || 64) : null,
    duracionS: Number(segundos.toFixed(1)),
    pedidos: m.http_reqs.values.count,
    throughput: Number((m.http_reqs.values.count / segundos).toFixed(2)),
    errores: m.http_req_failed.values.rate,
    duracionMs: {
      promedio: Number(d.avg.toFixed(2)),
      mediana: Number(d.med.toFixed(2)),
      p90: Number(d['p(90)'].toFixed(2)),
      p95: Number(d['p(95)'].toFixed(2)),
      p99: Number(d['p(99)'].toFixed(2)),
      max: Number(d.max.toFixed(2)),
    },
  };
  const salida = { stdout: JSON.stringify(resumen) + '\n' };
  if (__ENV.SALIDA) salida[__ENV.SALIDA] = JSON.stringify(resumen, null, 2);
  return salida;
}

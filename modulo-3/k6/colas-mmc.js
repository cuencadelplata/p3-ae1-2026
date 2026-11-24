// =============================================================================
// k6/colas-mmc.js — Prueba de carga para el modelo de colas M/M/c (M3)
// -----------------------------------------------------------------------------
// Escenario: fin de semana, tarde-noche (hora pico). Los conductores conectados
// envían un "heartbeat" de disponibilidad para no vencer el TTL en Redis:
//     PUT /api/conductores/{id}/disponible   { "disponible": true }
//
// A diferencia de load-test.js (usuarios virtuales), acá se usa el ejecutor
// constant-arrival-rate: k6 genera EXACTAMENTE λ pedidos por segundo, sin
// importar cuánto tarde el servidor. Así λ queda fijo y controlado, como en
// el modelo de colas (modelo "abierto").
//
// Parámetros (con -e NOMBRE=valor):
//   LAMBDA      pedidos por segundo que llegan (λ)            default 100
//   DURACION    duración de la medición                       default 60s
//   CONDUCTORES cantidad de conductores simulados             default 300
//   BASE_URL    destino (el balanceador)       default http://m3-conductor-api:3000
//   REPLICAS    cantidad de réplicas levantadas (solo para el nombre del archivo)
//
// Ejemplo (desde modulo-3, con el escalado levantado):
//   docker compose @esc run --rm -e LAMBDA=100 -e REPLICAS=2 k6 run /scripts/colas-mmc.js
// =============================================================================

import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://m3-conductor-api:3000';
const LAMBDA = parseInt(__ENV.LAMBDA || '100', 10);
const DURACION = __ENV.DURACION || '60s';
const CONDUCTORES = parseInt(__ENV.CONDUCTORES || '300', 10);
// Solo para nombrar el archivo de resultados: cuántas réplicas había (c)
const REPLICAS = __ENV.REPLICAS || 'x';

// Ids de prueba bien lejos de los reales (101-103) para no pisar datos.
const ID_BASE = 900000;

// Tiempo total de respuesta visto por el cliente (≈ W del modelo: espera + servicio)
const tiempoEnSistema = new Trend('tiempo_en_sistema_ms', true);
// Qué réplica atendió cada pedido (para comprobar el reparto del balanceador)
const atendidosPorReplica = new Counter('atendidos_por_replica');

export const options = {
  scenarios: {
    heartbeats_hora_pico: {
      executor: 'constant-arrival-rate',
      rate: LAMBDA,          // λ pedidos...
      timeUnit: '1s',        // ...por segundo
      duration: DURACION,
      preAllocatedVUs: Math.max(20, LAMBDA),
      maxVUs: Math.max(200, LAMBDA * 10),
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],   // meta del equipo: p95 < 800 ms
    http_req_failed: ['rate<0.05'],     // menos de 5% de errores
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'max'],
};

// -----------------------------------------------------------------------------
// setup(): se ejecuta UNA vez antes de medir. Marca a todos los conductores
// simulados como disponibles. Así, durante la medición, cada heartbeat repite
// el mismo valor: solo renueva el TTL en Redis, sin escribir en la base de
// datos ni publicar eventos. De ese modo se mide el servicio de la API, sin
// que la latencia de Supabase distorsione μ.
// -----------------------------------------------------------------------------
export function setup() {
  const params = { headers: { 'Content-Type': 'application/json' } };
  const cuerpo = JSON.stringify({ disponible: true });
  for (let i = 1; i <= CONDUCTORES; i++) {
    http.put(`${BASE_URL}/api/conductores/${ID_BASE + i}/disponible`, cuerpo, params);
  }
  return { inicio: new Date().toISOString() };
}

export default function () {
  const id = ID_BASE + 1 + Math.floor(Math.random() * CONDUCTORES);
  const res = http.put(
    `${BASE_URL}/api/conductores/${id}/disponible`,
    JSON.stringify({ disponible: true }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'PUT /api/conductores/{id}/disponible' },
    }
  );

  tiempoEnSistema.add(res.timings.duration);
  atendidosPorReplica.add(1, { replica: res.headers['X-Servido-Por'] || 'desconocida' });

  check(res, { 'status 200': (r) => r.status === 200 });
}

// Convierte "60s", "2m" o "1m30s" a segundos
function segundos(texto) {
  let total = 0;
  const partes = String(texto).match(/(\d+)(h|m|s)/g) || [];
  for (const p of partes) {
    const n = parseInt(p, 10);
    if (p.endsWith('h')) total += n * 3600;
    else if (p.endsWith('m')) total += n * 60;
    else total += n;
  }
  return total || 1;
}

// -----------------------------------------------------------------------------
// Resumen corto con los datos que necesita el modelo de colas
// -----------------------------------------------------------------------------
export function handleSummary(data) {
  const m = data.metrics;
  const dur = m.http_req_duration ? m.http_req_duration.values : {};
  // Throughput real = pedidos de la MEDICIÓN / duración de la medición.
  // (No se usa http_reqs porque también cuenta los pedidos de setup().)
  const iteraciones = m.iterations ? m.iterations.values.count : 0;
  const throughput = iteraciones / segundos(DURACION);
  const fallidos = m.http_req_failed ? m.http_req_failed.values.rate : 0;
  const descartados = m.dropped_iterations ? m.dropped_iterations.values.count : 0;
  const f = (x) => (x === undefined ? '-' : x.toFixed(2));

  const resumen = [
    '',
    '================ RESULTADO PARA EL MODELO M/M/c ================',
    `Réplicas (c)                      : ${REPLICAS}`,
    `λ pedida (LAMBDA)                 : ${LAMBDA} pedidos/s`,
    `Pedidos medidos                   : ${iteraciones}`,
    `Throughput real (atendidos/s)     : ${f(throughput)} pedidos/s`,
    `Pedidos que k6 no pudo lanzar     : ${descartados}  (si es > 0, el sistema no da abasto)`,
    `W medio (tiempo en el sistema)    : ${f(dur.avg)} ms`,
    `W mediana                         : ${f(dur.med)} ms`,
    `W p95                             : ${f(dur['p(95)'])} ms`,
    `W máximo                          : ${f(dur.max)} ms`,
    `Errores                           : ${f(fallidos * 100)} %`,
    '=================================================================',
    '',
  ].join('\n');

  return {
    stdout: resumen,
    [`/scripts/resultados/c${REPLICAS}-lambda${LAMBDA}.json`]: JSON.stringify(data, null, 2),
  };
}

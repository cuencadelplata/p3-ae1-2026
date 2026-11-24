// RF-2.2 Direcciones frecuentes: genera tráfico para los paneles 4 a 11 del tablero.
// Cada iteración recorre el ciclo completo de una favorita y fuerza, a propósito,
// los casos que las métricas tienen que mostrar:
//   - repetición del alta con la misma Idempotency-Key  → resultado="replay"
//   - dos PATCH simultáneos con la misma versión        → uno ok, el otro conflicto_version o conflicto_concurrente
//   - viaje completado enviado dos veces por RabbitMQ   → viajes_recientes resultado="duplicado"
//   - lecturas repetidas de la lista                    → aciertos de caché
// Uso (desde m2/, con el compose y el de observabilidad levantados):
//   docker compose -f docker-compose.yml -f docker-compose.observability.yml run --rm k6 run /scripts/direcciones.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE, prepareUsers, withToken } from './lib.js';

const USERS = Number(__ENV.USERS || 10);
const M6_SIM = __ENV.M6_SIM_URL || 'http://localhost:4000';
const SERVICE_KEY = __ENV.INTEGRATION_SECRET || 'integration-dev';

export const options = {
  scenarios: {
    direcciones: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 5 },
        { duration: '1m', target: USERS },
        { duration: '20s', target: 0 },
      ],
    },
  },
  thresholds: {
    // Los 409/412 provocados a propósito se declaran esperados en cada pedido.
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:direcciones-lista}': ['p(95)<300'],
    'http_req_duration{name:direcciones-sugerencias}': ['p(95)<500'],
    checks: ['rate>0.98'],
  },
  tags: { testid: 'm2-direcciones' },
};

export function setup() {
  return { users: prepareUsers(USERS) };
}

function headers(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra };
}

function key(prefix) {
  return `${prefix}-${__VU}-${__ITER}-${Date.now()}`;
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
}

export default function ({ users }) {
  const { userId, token } = users[(__VU - 1) % users.length];
  const lat = -27.45 - Math.random() / 10;
  const lng = -58.98 - Math.random() / 10;
  const body = JSON.stringify({
    tipo: Math.random() < 0.5 ? 'ORIGEN' : 'DESTINO',
    etiqueta: `Prueba ${__VU}-${__ITER}`,
    direccion: `Calle de prueba ${__VU}-${__ITER}, Resistencia`,
    latitud: Number(lat.toFixed(6)),
    longitud: Number(lng.toFixed(6)),
  });

  // 1. Alta + repetición idempotente (misma clave y mismo cuerpo).
  const idemKey = key('alta');
  const alta = http.post(`${BASE}/api/v1/direcciones`, body, {
    headers: headers(token, { 'Idempotency-Key': idemKey }),
    tags: { name: 'direcciones-alta' },
  });
  check(alta, { 'alta 201': (r) => r.status === 201 });
  const replay = http.post(`${BASE}/api/v1/direcciones`, body, {
    headers: headers(token, { 'Idempotency-Key': idemKey }),
    tags: { name: 'direcciones-alta-repetida' },
  });
  check(replay, { 'repetición idempotente': (r) => r.headers['Idempotency-Replayed'] === 'true' });
  if (alta.status !== 201) return;
  const id = alta.json('data.id');
  let version = alta.json('data.version');

  // 2. Lecturas: la primera puede ser MISS, las siguientes HIT hasta el próximo cambio.
  for (let i = 0; i < 3; i++) {
    check(http.get(`${BASE}/api/v1/direcciones`, withToken(token, 'direcciones-lista')), {
      'lista 200': (r) => r.status === 200,
    });
  }
  check(http.get(`${BASE}/api/v1/direcciones/sugerencias`, withToken(token, 'direcciones-sugerencias')), {
    'sugerencias 200': (r) => r.status === 200,
  });

  // 3. Dos ediciones simultáneas con la misma versión: sólo una puede ganar.
  const patch = (etiqueta) => ({
    method: 'PATCH',
    url: `${BASE}/api/v1/direcciones/${id}`,
    body: JSON.stringify({ etiqueta }),
    params: {
      headers: headers(token, { 'Idempotency-Key': key(etiqueta), 'If-Match': `"${version}"` }),
      tags: { name: 'direcciones-edicion-concurrente' },
      responseCallback: http.expectedStatuses(200, 409, 412),
    },
  });
  const [a, b] = http.batch([patch('Casa'), patch('Trabajo')]);
  check([a, b], { 'una sola edición gana': (rs) => rs.filter((r) => r.status === 200).length === 1 });
  const ganadora = a.status === 200 ? a : b;
  if (ganadora.status === 200) version = ganadora.json('data.version');

  // 4. Viaje completado publicado dos veces (el segundo debe contarse como duplicado).
  if (__ITER % 3 === 0) {
    const evento = JSON.stringify({
      eventId: uuid(),
      correlationId: key('k6'),
      data: {
        viajeId: key('viaje'),
        clienteId: String(userId),
        origen: { direccion: 'Plaza 25 de Mayo, Resistencia', latitud: -27.4513, longitud: -58.9866 },
        destino: { direccion: 'Terminal de Ómnibus, Resistencia', latitud: -27.4767, longitud: -59.0112 },
      },
    });
    const sim = { headers: { 'Content-Type': 'application/json', 'x-service-key': SERVICE_KEY }, tags: { name: 'm6-sim-evento' } };
    http.post(`${M6_SIM}/demo/viajes/completados`, evento, sim);
    http.post(`${M6_SIM}/demo/viajes/completados`, evento, sim);
  }

  // 5. Geocodificación (M4 simulado). Un 503 también es dato: mide la disponibilidad de M4.
  http.get(`${BASE}/api/v1/geocodificacion?q=Plaza`, {
    ...withToken(token, 'geocodificacion'),
    responseCallback: http.expectedStatuses(200, 503),
  });

  // 6. Baja de la favorita para no acumular datos entre corridas.
  check(
    http.del(`${BASE}/api/v1/direcciones/${id}`, null, {
      headers: headers(token, { 'Idempotency-Key': key('baja'), 'If-Match': `"${version}"` }),
      tags: { name: 'direcciones-baja' },
    }),
    { 'baja 200': (r) => r.status === 200 }
  );
  sleep(1);
}

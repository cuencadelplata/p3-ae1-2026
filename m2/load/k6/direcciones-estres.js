// Estrés de RF-2.2 Direcciones frecuentes: sube la cantidad de pedidos por segundo
// por escalones hasta que M2 empieza a degradarse, para encontrar su límite.
// Mezcla parecida al uso real: casi todo lecturas (lista y sugerencias) y pocas escrituras.
//   70 % lista de direcciones   (GET /api/v1/direcciones)
//   20 % sugerencias            (GET /api/v1/direcciones/sugerencias)
//   10 % alta + baja de favorita (POST y DELETE /api/v1/direcciones)
// Uso (desde m2/, con el compose y el de observabilidad levantados):
//   docker compose -f docker-compose.yml -f docker-compose.observability.yml run --rm k6 run /scripts/direcciones-estres.js
// Variables: PICO (pedidos/s del último escalón, default 300), USERS (default 30).
import http from 'k6/http';
import { check } from 'k6';
import { BASE, prepareUsers, withToken } from './lib.js';

const USERS = Number(__ENV.USERS || 30);
const PICO = Number(__ENV.PICO || 300);

export const options = {
  scenarios: {
    estres: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 400,
      stages: [
        { duration: '30s', target: Math.round(PICO * 0.25) }, // calentamiento
        { duration: '1m', target: Math.round(PICO * 0.5) },
        { duration: '1m', target: Math.round(PICO * 0.75) },
        { duration: '1m', target: PICO }, // pico
        { duration: '30s', target: 0 }, // recuperación
      ],
    },
  },
  // En estrés los umbrales no cortan la prueba: muestran en qué escalón se rompió.
  thresholds: {
    http_req_failed: ['rate<0.05'],
    'http_req_duration{name:direcciones-lista}': ['p(95)<500'],
    'http_req_duration{name:direcciones-sugerencias}': ['p(95)<800'],
    'http_req_duration{name:direcciones-alta}': ['p(95)<1000'],
  },
  tags: { testid: 'm2-direcciones-estres' },
};

function headers(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra };
}

// Cada usuario arranca con dos favoritas para que la lista y las sugerencias no estén vacías.
export function setup() {
  const users = prepareUsers(USERS);
  for (const { userId, token } of users) {
    for (const [i, tipo] of [['1', 'ORIGEN'], ['2', 'DESTINO']]) {
      http.post(
        `${BASE}/api/v1/direcciones`,
        JSON.stringify({ tipo, etiqueta: `Base ${i}`, direccion: `Base ${i} usuario ${userId}, Resistencia` }),
        {
          headers: headers(token, { 'Idempotency-Key': `estres-base-${userId}-${i}` }),
          tags: { name: 'setup' },
          // 201 la primera vez; 409 DUPLICATE_ADDRESS si quedó de una corrida anterior.
          responseCallback: http.expectedStatuses(201, 409),
        }
      );
    }
  }
  return { users };
}

export default function ({ users }) {
  const { token } = users[Math.floor(Math.random() * users.length)];
  const r = Math.random();

  if (r < 0.7) {
    check(http.get(`${BASE}/api/v1/direcciones`, withToken(token, 'direcciones-lista')), {
      'lista 200': (res) => res.status === 200,
    });
    return;
  }
  if (r < 0.9) {
    check(http.get(`${BASE}/api/v1/direcciones/sugerencias`, withToken(token, 'direcciones-sugerencias')), {
      'sugerencias 200': (res) => res.status === 200,
    });
    return;
  }

  const id = `${__VU}-${__ITER}-${Date.now()}`;
  const alta = http.post(
    `${BASE}/api/v1/direcciones`,
    JSON.stringify({ tipo: 'DESTINO', direccion: `Estrés ${id}, Resistencia` }),
    { headers: headers(token, { 'Idempotency-Key': `estres-alta-${id}` }), tags: { name: 'direcciones-alta' } }
  );
  if (!check(alta, { 'alta 201': (res) => res.status === 201 })) return;
  check(
    http.del(`${BASE}/api/v1/direcciones/${alta.json('data.id')}`, null, {
      headers: headers(token, { 'Idempotency-Key': `estres-baja-${id}`, 'If-Match': `"${alta.json('data.version')}"` }),
      tags: { name: 'direcciones-baja' },
    }),
    { 'baja 200': (res) => res.status === 200 }
  );
}

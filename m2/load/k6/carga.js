// Carga: dos escenarios en paralelo durante 2 minutos.
//   - clientes: usuarios que consultan su perfil y sus direcciones (RF-2.1, RF-2.2).
//   - m8_preferencias: M8 consultando preferencias antes de cada PUSH (RF8.7).
// El umbral de 1800 ms es el plazo acordado con M8 (M8 corta a los 3000 ms).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE, prepareUsers, withToken, withApiKey } from './lib.js';

const USERS = Number(__ENV.USERS || 20);

export const options = {
  scenarios: {
    clientes: {
      executor: 'ramping-vus',
      exec: 'clientes',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 20 },
        { duration: '30s', target: 0 },
      ],
    },
    m8_preferencias: {
      executor: 'constant-arrival-rate',
      exec: 'preferencias',
      rate: 20,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 10,
      maxVUs: 30,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{scenario:clientes}': ['p(95)<500'],
    'http_req_duration{name:internal-preferences}': ['p(95)<1800'],
    checks: ['rate>0.99'],
  },
  tags: { testid: 'm2-carga' },
};

export function setup() {
  return { users: prepareUsers(USERS) };
}

function pick(users) {
  return users[Math.floor(Math.random() * users.length)];
}

export function clientes({ users }) {
  const { token } = pick(users);
  check(http.get(`${BASE}/v1/customers/me`, withToken(token, 'customers-me')), {
    'perfil 200': (r) => r.status === 200,
  });
  check(http.get(`${BASE}/api/v1/direcciones`, withToken(token, 'direcciones')), {
    'direcciones 200': (r) => r.status === 200,
  });
  sleep(1);
}

export function preferencias({ users }) {
  const { userId } = pick(users);
  check(http.get(`${BASE}/internal/preferences/${userId}`, withApiKey('internal-preferences')), {
    'preferencias 200': (r) => r.status === 200,
  });
}

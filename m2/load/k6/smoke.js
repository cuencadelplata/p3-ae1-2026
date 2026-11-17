// Smoke: 1 usuario virtual durante 30 s. Confirma que M2 responde antes de una prueba de carga.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE, prepareUsers, withToken, withApiKey } from './lib.js';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
    checks: ['rate>0.99'],
  },
  tags: { testid: 'm2-smoke' },
};

export function setup() {
  return { users: prepareUsers(1) };
}

export default function ({ users }) {
  const { userId, token } = users[0];

  check(http.get(`${BASE}/health/live`, { tags: { name: 'health' } }), {
    'health 200': (r) => r.status === 200,
  });
  check(http.get(`${BASE}/v1/customers/me`, withToken(token, 'customers-me')), {
    'perfil 200': (r) => r.status === 200,
  });
  check(http.get(`${BASE}/internal/preferences/${userId}`, withApiKey('internal-preferences')), {
    'preferencias 200 con push': (r) => r.status === 200 && r.json('pushEnabled') === true,
  });
  sleep(1);
}

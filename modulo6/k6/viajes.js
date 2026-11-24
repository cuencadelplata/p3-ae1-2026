import http from 'k6/http';
import { check } from 'k6';

const baseUrl = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const profile = __ENV.K6_PROFILE || 'load';

const profileOptions = {
  smoke: { vus: 1, iterations: 5 },
  load: {
    stages: [
      { duration: '30s', target: 5 },
      { duration: '1m', target: 20 },
      { duration: '30s', target: 0 },
    ],
  },
  stress: {
    stages: [
      { duration: '30s', target: 25 },
      { duration: '30s', target: 50 },
      { duration: '1m', target: 100 },
      { duration: '1m', target: 100 },
      { duration: '30s', target: 0 },
    ],
  },
};

export const options = {
  ...(profileOptions[profile] || profileOptions.load),
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const healthResponse = http.get(`${baseUrl}/health`, {
    tags: { name: 'health' },
  });
  const healthOk = check(healthResponse, {
    'health responde 200': (response) => response.status === 200,
  });

  if (!healthOk) return;

  const createResponse = http.post(
    `${baseUrl}/api/viajes`,
    JSON.stringify({
      clienteId: `k6-${__VU}-${__ITER}`,
      origen: 'Av. Siempre Viva 742',
      destino: 'Plaza Central',
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'crear_viaje' },
    },
  );

  const createOk = check(createResponse, {
    'crear viaje responde 201': (response) => response.status === 201,
    'crear viaje devuelve id': (response) => {
      if (response.status !== 201) return false;
      try {
        return typeof JSON.parse(response.body).id === 'string';
      } catch {
        return false;
      }
    },
  });

  if (!createOk) return;

  const viajeId = JSON.parse(createResponse.body).id;
  const getResponse = http.get(`${baseUrl}/api/viajes/${viajeId}`, {
    tags: { name: 'obtener_viaje' },
  });

  check(getResponse, {
    'obtener viaje responde 200': (response) => response.status === 200,
    'obtener viaje conserva id y estado': (response) => {
      if (response.status !== 200) return false;
      try {
        const viaje = JSON.parse(response.body);
        return viaje.id === viajeId && viaje.estado === 'SOLICITADO';
      } catch {
        return false;
      }
    },
  });
}
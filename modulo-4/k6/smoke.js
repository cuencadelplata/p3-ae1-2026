import http from 'k6/http';
import { check, group } from 'k6';

const baseUrl = (__ENV.K6_BASE_URL || 'http://m4-api:3004').replace(/\/$/, '');

export const options = {
  scenarios: {
    smoke: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '30s',
    },
  },
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
  tags: {
    service: 'm4-location-service',
    test_type: 'smoke',
  },
};

export default function () {
  group('salud del servicio', () => {
    const liveness = http.get(`${baseUrl}/health/liveness`, {
      tags: { endpoint: 'liveness' },
    });
    check(liveness, {
      'liveness responde 200': (response) => response.status === 200,
      'liveness informa UP': (response) => response.json('status') === 'UP',
    });

    const readiness = http.get(`${baseUrl}/health/readiness`, {
      tags: { endpoint: 'readiness' },
    });
    check(readiness, {
      'readiness responde 200': (response) => response.status === 200,
      'readiness informa UP': (response) => response.json('status') === 'UP',
    });
  });

  group('operaciones publicas principales', () => {
    const nearby = http.get(
      `${baseUrl}/api/v1/drivers/nearby?latitude=-27.4692&longitude=-58.8306&vehicleType=AUTO&radiusKm=5&maxCandidates=10`,
      { tags: { endpoint: 'nearby' } },
    );
    check(nearby, {
      'nearby responde 200': (response) => response.status === 200,
      'nearby devuelve drivers': (response) => Array.isArray(response.json('drivers')),
    });

    const estimate = http.post(
      `${baseUrl}/api/v1/estimate`,
      JSON.stringify({
        origin: { latitude: -27.4692, longitude: -58.8306 },
        destination: { latitude: -27.4875, longitude: -58.7896 },
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { endpoint: 'estimate' },
      },
    );
    check(estimate, {
      'estimate responde 200': (response) => response.status === 200,
      'estimate devuelve distancia': (response) => Number(response.json('distanceKm')) >= 0,
      'estimate devuelve ETA': (response) => Number(response.json('estimatedEtaMinutes')) >= 1,
    });
  });
}

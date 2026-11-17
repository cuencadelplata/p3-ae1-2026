import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = (__ENV.K6_BASE_URL || 'http://m4-api:3004').replace(/\/$/, '');

export const options = {
  scenarios: {
    nearby_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 5 },
        { duration: '20s', target: 10 },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:nearby}': ['p(95)<500'],
  },
  tags: {
    service: 'm4-location-service',
    test_type: 'load',
  },
};

export default function () {
  const vehicleType = __VU % 2 === 0 ? 'AUTO' : 'MOTO';
  const latitude = -27.4692 + (__VU % 5) * 0.0001;
  const longitude = -58.8306 + (__ITER % 5) * 0.0001;
  const url = `${baseUrl}/api/v1/drivers/nearby?latitude=${latitude}&longitude=${longitude}&vehicleType=${vehicleType}&radiusKm=5&maxCandidates=10`;

  const response = http.get(url, { tags: { endpoint: 'nearby' } });

  check(response, {
    'nearby responde 200': (result) => result.status === 200,
    'respuesta contiene drivers': (result) => Array.isArray(result.json('drivers')),
    'count coincide con drivers': (result) => result.json('count') === result.json('drivers').length,
  });

  sleep(1);
}

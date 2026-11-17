import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '15s', target: 10 },
    { duration: '30s', target: 20 },
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const resCond = http.get('http://m3-conductor-api:3000/api/conductores');
  check(resCond, { 'conductores status 200': (r) => r.status === 200 });

  const resVeh = http.get('http://m3-vehiculos:8083/health');
  check(resVeh, { 'vehiculos status 200': (r) => r.status === 200 });

  sleep(1);
}
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const consistencyRate = new Rate('race_consistency_rate');
const cancelWonCounter = new Counter('cancel_won_200_total');
const acceptWonCounter = new Counter('accept_won_200_total');
const conflictHandledCounter = new Counter('conflict_handled_409_total');
const unexpectedErrorCounter = new Counter('unexpected_error_total');
const raceLatency = new Trend('cancel_vs_accept_latency_ms');

export const options = {
  stages: [
    { duration: '5s', target: 10 },
    { duration: '15s', target: 30 },
    { duration: '15s', target: 50 },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    race_consistency_rate: ['rate>0.99'], // 100% consistencia de máquina de estados
    unexpected_error_total: ['count<1'],    // Cero 500s
    http_req_duration: ['p(95)<300'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3005';

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function () {
  const vuId = __VU;
  const iterId = __ITER;
  const clientId = `client_can_race_${vuId}_${iterId}_${Date.now()}`;
  const idempotencyKey = uuidv4();

  const clientHeaders = {
    'Content-Type': 'application/json',
    'x-user-id': clientId,
    'x-client-id': clientId,
    'Idempotency-Key': idempotencyKey,
  };

  // 1. Crear solicitud
  const createRes = http.post(
    `${BASE_URL}/api/v1/ride-requests`,
    JSON.stringify({
      origin: { latitude: -34.6037, longitude: -58.3816, address: 'Plaza de Mayo, CABA' },
      destination: { latitude: -34.5885, longitude: -58.3974, address: 'Congreso, CABA' },
      vehicleType: 'AUTO',
    }),
    { headers: clientHeaders }
  );

  if (createRes.status !== 201) {
    unexpectedErrorCounter.add(1);
    return;
  }
  const requestId = JSON.parse(createRes.body).id;

  // 2. Despachar ofertas
  const offersRes = http.post(
    `${BASE_URL}/api/v1/ride-requests/${requestId}/offers`,
    JSON.stringify({ ttlSeconds: 30 }),
    { headers: clientHeaders }
  );

  if (offersRes.status !== 201) {
    unexpectedErrorCounter.add(1);
    return;
  }

  const offers = JSON.parse(offersRes.body).offers || [];
  if (offers.length === 0) return;

  const offer = offers[0];
  const driverHeaders = {
    'Content-Type': 'application/json',
    'x-user-id': offer.driverId,
    'x-driver-id': offer.driverId,
    'x-user-role': 'CONDUCTOR',
  };

  // 3. CARRERA SIMULTÁNEA: Pasajero cancela VS Conductor acepta al mismo milisegundo
  const start = Date.now();
  const responses = http.batch([
    [
      'POST',
      `${BASE_URL}/api/v1/ride-requests/${requestId}/cancel`,
      JSON.stringify({ reason: 'Cancelación previa (RF-5.6)' }),
      { headers: clientHeaders },
    ],
    [
      'POST',
      `${BASE_URL}/api/v1/offers/${offer.id}/accept`,
      JSON.stringify({ driverId: offer.driverId }),
      { headers: driverHeaders },
    ],
  ]);
  raceLatency.add(Date.now() - start);

  const cancelRes = responses[0];
  const acceptRes = responses[1];

  let consistent = false;

  if (cancelRes.status === 200 && acceptRes.status === 409) {
    // Ganó la cancelación: la solicitud fue cancelada antes de que el conductor aceptara
    cancelWonCounter.add(1);
    conflictHandledCounter.add(1);
    consistent = true;
  } else if (acceptRes.status === 200 && cancelRes.status === 409) {
    // Ganó la aceptación: el viaje fue asignado antes de la cancelación
    acceptWonCounter.add(1);
    conflictHandledCounter.add(1);
    consistent = true;
  } else {
    // Estado inválido o error inesperado (ej. ambos 200, o 500)
    unexpectedErrorCounter.add(1);
    consistent = false;
  }

  consistencyRate.add(consistent ? 1 : 0);

  check(null, {
    'consistencia de exclusión (uno 200 y el otro 409)': () => consistent,
  });

  sleep(0.1 + Math.random() * 0.1);
}

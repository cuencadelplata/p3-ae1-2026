import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Métricas de contención y exclusión mutua
const singleWinnerCheckRate = new Rate('atomic_single_winner_rate');
const raceWonTotal = new Counter('race_won_200_ok_total');
const raceLostConflictTotal = new Counter('race_lost_409_conflict_total');
const unexpectedErrorTotal = new Counter('unexpected_error_total');
const contentionLatency = new Trend('contention_response_time_ms');

export const options = {
  stages: [
    { duration: '5s', target: 10 },  // 10 VUs compitiendo
    { duration: '15s', target: 30 }, // 30 VUs (hasta 90 requests en paralelo por segundo)
    { duration: '15s', target: 50 }, // 50 VUs bajo estrés extremo
    { duration: '5s', target: 0 },   // Cooldown
  ],
  thresholds: {
    atomic_single_winner_rate: ['rate>0.99'], // 100% de las carreras deben tener exactamente 1 ganador
    unexpected_error_total: ['count<1'],       // Cero errores 500
    http_req_duration: ['p(95)<300', 'p(99)<600'],
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
  const clientId = `client_race_${vuId}_${iterId}_${Date.now()}`;
  const idempotencyKey = uuidv4();

  const clientHeaders = {
    'Content-Type': 'application/json',
    'x-user-id': clientId,
    'x-client-id': clientId,
    'Idempotency-Key': idempotencyKey,
  };

  // 1. Crear solicitud de viaje
  const createRes = http.post(
    `${BASE_URL}/api/v1/ride-requests`,
    JSON.stringify({
      origin: { latitude: -34.6037, longitude: -58.3816, address: 'Obelisco, CABA' },
      destination: { latitude: -34.5885, longitude: -58.3974, address: 'Recoleta, CABA' },
      vehicleType: 'AUTO',
    }),
    { headers: clientHeaders }
  );

  if (createRes.status !== 201) {
    unexpectedErrorTotal.add(1);
    return;
  }

  const requestId = JSON.parse(createRes.body).id;

  // 2. Despachar ofertas a múltiples conductores con TTL de 30s
  const offersRes = http.post(
    `${BASE_URL}/api/v1/ride-requests/${requestId}/offers`,
    JSON.stringify({ ttlSeconds: 30 }),
    { headers: clientHeaders }
  );

  if (offersRes.status !== 201) {
    unexpectedErrorTotal.add(1);
    return;
  }

  const createdOffers = JSON.parse(offersRes.body).offers || [];
  if (createdOffers.length < 2) {
    // Si hay menos de 2 ofertas, no hay colisión posible
    return;
  }

  // 3. RÁFAGA CONCURRENTE (http.batch): Todos los conductores envían ACCEPT simultáneamente
  const batchRequests = createdOffers.map((offer) => {
    return [
      'POST',
      `${BASE_URL}/api/v1/offers/${offer.id}/accept`,
      JSON.stringify({ driverId: offer.driverId }),
      {
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': offer.driverId,
          'x-driver-id': offer.driverId,
          'x-user-role': 'CONDUCTOR',
        },
      },
    ];
  });

  const start = Date.now();
  const responses = http.batch(batchRequests);
  contentionLatency.add(Date.now() - start);

  // 4. Verificación de Exclusión Mutua Atómica (RNF-08 / RF-5.5):
  // Exactamente 1 conductor debe obtener 200 OK.
  // Todos los demás conductores deben recibir 409 Conflict.
  let winners = 0;
  let conflicts = 0;
  let unexpected = 0;

  for (const res of responses) {
    if (res.status === 200) {
      winners++;
      raceWonTotal.add(1);
    } else if (res.status === 409) {
      conflicts++;
      raceLostConflictTotal.add(1);
    } else {
      unexpected++;
      unexpectedErrorTotal.add(1);
    }
  }

  const isAtomicSuccess = winners === 1 && conflicts === responses.length - 1 && unexpected === 0;
  singleWinnerCheckRate.add(isAtomicSuccess ? 1 : 0);

  check(null, {
    'exactamente 1 ganador (200 OK) y los demás conflicto (409)': () => isAtomicSuccess,
  });

  sleep(0.1 + Math.random() * 0.1);
}

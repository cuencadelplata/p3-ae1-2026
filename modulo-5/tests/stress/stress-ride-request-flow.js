import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Métricas personalizadas
const rideCreatedCounter = new Counter('rides_created_total');
const offersDispatchedCounter = new Counter('offers_dispatched_total');
const ridesAssignedCounter = new Counter('rides_assigned_total');
const errorRate = new Rate('custom_error_rate');
const creationLatencyTrend = new Trend('ride_creation_duration_ms');

// Configuración de etapas de carga progresiva (Stress Testing Profile)
export const options = {
  stages: [
    { duration: '5s', target: 10 },   // Warm-up: 10 usuarios virtuales
    { duration: '15s', target: 30 },  // Rampa a carga nominal sostenida (30 VUs)
    { duration: '20s', target: 60 },  // Rampa a estrés alto (60 VUs)
    { duration: '10s', target: 100 }, // Pico de estrés extremo (100 VUs)
    { duration: '10s', target: 20 },  // Descenso de carga (cooldown)
    { duration: '5s', target: 0 },    // Fin
  ],
  thresholds: {
    http_req_duration: ['p(95)<600', 'p(99)<1200'], // RNF: 95% de requests bajo 600ms, 99% bajo 1.2s
    http_req_failed: ['rate<0.02'],                  // Máximo 2% de fallos bajo estrés extremo
    custom_error_rate: ['rate<0.02'],
    'ride_creation_duration_ms': ['p(95)<500'],
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
  const clientId = `client_vu_${vuId}_iter_${iterId}_${Date.now()}`;
  const idempotencyKey = uuidv4();

  const headers = {
    'Content-Type': 'application/json',
    'x-user-id': clientId,
    'x-client-id': clientId,
    'Idempotency-Key': idempotencyKey,
  };

  let requestId = null;
  let offers = [];

  group('01_Creacion_Solicitud_Viaje', function () {
    const payload = JSON.stringify({
      origin: {
        latitude: -34.6037 + (Math.random() * 0.01 - 0.005),
        longitude: -58.3816 + (Math.random() * 0.01 - 0.005),
        address: `Av. Corrientes ${1000 + vuId * 10}, CABA`,
      },
      destination: {
        latitude: -34.5885 + (Math.random() * 0.01 - 0.005),
        longitude: -58.3974 + (Math.random() * 0.01 - 0.005),
        address: `Av. Santa Fe ${2000 + vuId * 10}, CABA`,
      },
      vehicleType: vuId % 2 === 0 ? 'AUTO' : 'MOTO',
    });

    const start = Date.now();
    const res = http.post(`${BASE_URL}/api/v1/ride-requests`, payload, { headers });
    creationLatencyTrend.add(Date.now() - start);

    const success = check(res, {
      'status es 201 Created': (r) => r.status === 201,
      'tiene ID de solicitud': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.id !== undefined && body.id !== null;
        } catch (_) {
          return false;
        }
      },
      'tarifa estimada > 0': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.estimatedFare !== undefined && (
            (typeof body.estimatedFare === 'object' && body.estimatedFare.amount > 0) ||
            (typeof body.estimatedFare === 'number' && body.estimatedFare > 0)
          );
        } catch (_) {
          return false;
        }
      },
    });

    if (!success) {
      errorRate.add(1);
      return;
    }

    errorRate.add(0);
    rideCreatedCounter.add(1);

    const body = JSON.parse(res.body);
    requestId = body.id;
  });

  if (!requestId) {
    sleep(0.5);
    return;
  }

  group('02_Consulta_Estado_Solicitud', function () {
    const res = http.get(`${BASE_URL}/api/v1/ride-requests/${requestId}`, { headers });
    const success = check(res, {
      'status get es 200 OK': (r) => r.status === 200,
      'coincide el id de viaje': (r) => {
        try {
          return JSON.parse(r.body).id === requestId;
        } catch (_) {
          return false;
        }
      },
    });

    if (!success) errorRate.add(1);
    else errorRate.add(0);
  });

  group('03_Busqueda_Candidatos_Cercanos', function () {
    const candidatePayload = JSON.stringify({
      radiusKm: 5.0,
      maxCandidates: 5,
    });

    const res = http.post(`${BASE_URL}/api/v1/ride-requests/${requestId}/candidates`, candidatePayload, { headers });
    const success = check(res, {
      'status candidatos es 200 OK': (r) => r.status === 200,
      'lista de candidatos presente': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body.candidates) && body.candidates.length > 0;
        } catch (_) {
          return false;
        }
      },
    });

    if (!success) errorRate.add(1);
    else errorRate.add(0);
  });

  group('04_Despacho_Ofertas_Con_TTL', function () {
    const offerPayload = JSON.stringify({
      ttlSeconds: 30,
    });

    const res = http.post(`${BASE_URL}/api/v1/ride-requests/${requestId}/offers`, offerPayload, { headers });
    const success = check(res, {
      'status ofertas es 201 Created': (r) => r.status === 201,
      'ofertas despachadas con éxito': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.offersSentCount > 0 || body.offersCount > 0 || (Array.isArray(body.offers) && body.offers.length > 0);
        } catch (_) {
          return false;
        }
      },
    });

    if (!success) {
      errorRate.add(1);
      return;
    }

    errorRate.add(0);
    offersDispatchedCounter.add(1);
  });

  group('05_Consulta_Ofertas_Emitidas', function () {
    const res = http.get(`${BASE_URL}/api/v1/ride-requests/${requestId}/offers`, { headers });
    const success = check(res, {
      'status get ofertas es 200 OK': (r) => r.status === 200,
      'recupera lista de ofertas': (r) => {
        try {
          const body = JSON.parse(r.body);
          if (Array.isArray(body.offers) && body.offers.length > 0) {
            offers = body.offers;
            return true;
          }
          return false;
        } catch (_) {
          return false;
        }
      },
    });

    if (!success) errorRate.add(1);
    else errorRate.add(0);
  });

  if (offers.length > 0) {
    group('06_Aceptacion_Oferta_Por_Conductor', function () {
      const selectedOffer = offers[0];
      const driverHeaders = {
        'Content-Type': 'application/json',
        'x-user-id': selectedOffer.driverId,
        'x-driver-id': selectedOffer.driverId,
        'x-user-role': 'CONDUCTOR',
      };

      const res = http.post(
        `${BASE_URL}/api/v1/offers/${selectedOffer.id}/accept`,
        JSON.stringify({ driverId: selectedOffer.driverId }),
        { headers: driverHeaders }
      );

      const success = check(res, {
        'status aceptacion es 200 OK': (r) => r.status === 200,
        'oferta asignada con exito': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.status === 'ACCEPTED' || body.success === true || body.assignedDriverId !== undefined;
          } catch (_) {
            return false;
          }
        },
      });

      if (!success) errorRate.add(1);
      else {
        errorRate.add(0);
        ridesAssignedCounter.add(1);
      }
    });
  }

  group('07_Auditoria_Inmutable_Eventos', function () {
    const res = http.get(`${BASE_URL}/api/v1/ride-requests/${requestId}/audit`, { headers });
    check(res, {
      'status auditoria es 200 OK': (r) => r.status === 200,
      'trazas de auditoria registradas': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.count > 0 && Array.isArray(body.events);
        } catch (_) {
          return false;
        }
      },
    });
  });

  // Pausa realista entre transacciones (pacing de 200ms a 500ms)
  sleep(0.2 + Math.random() * 0.3);
}

import request from 'supertest';
import { app } from '../../src/index';

/**
 * Tests de Integración HTTP (Supertest) — M5 Solicitud y Despacho
 * Cubre endpoints de API v1 para:
 * - Health Check (RNF-16)
 * - RF-5.1: Solicitud de viaje (POST, GET, Idempotencia, Validaciones, Conflictos)
 * - RF-5.2: Búsqueda de candidatos (POST /candidates)
 * - RF-5.3: Oferta con vencimiento (POST /offers, GET /offers)
 * - RF-5.4: Aceptar o rechazar oferta (POST /respond, POST /accept, POST /reject, GET /drivers/:id/offers)
 * - RF-5.5: Asignación única (Concurrencia y expiración de otras ofertas)
 * - RF-5.6: Cancelación previa (POST /cancel, bloqueo si ASSIGNED)
 * - RF-5.7: Sin disponibilidad (Filtro sin candidatos o rechazo total)
 */
describe('M5 Dispatch Service — API Integration Tests', () => {
  const getUniqueClientId = (prefix = 'client') => `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const getUniqueKey = () => `key_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const validPayload = {
    origin: {
      latitude: -34.6037,
      longitude: -58.3816,
      address: 'Av. 9 de Julio y Corrientes (Obelisco)',
    },
    destination: {
      latitude: -34.5885,
      longitude: -58.3974,
      address: 'Av. Alvear 1891 (Recoleta)',
    },
    vehicleType: 'AUTO',
  };

  // ==========================================================================
  // Health Check
  // ==========================================================================
  describe('GET /health (RNF-16)', () => {
    it('debe responder 200 con status UP', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('UP');
      expect(res.body.service).toBe('m5-dispatch-service');
      expect(res.body.timestamp).toBeDefined();
    });
  });

  // ==========================================================================
  // RF-5.1: Solicitud de viaje
  // ==========================================================================
  describe('RF-5.1: POST /api/v1/ride-requests & GET /api/v1/ride-requests/:requestId', () => {
    it('debe crear una solicitud de viaje con código HTTP 201', async () => {
      const clientId = getUniqueClientId();
      const idempotencyKey = getUniqueKey();

      const res = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', idempotencyKey)
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.clientId).toBe(clientId);
      expect(res.body.status).toBe('SEARCHING');
      expect(res.body.estimatedFare).toBeDefined();
      expect(res.body.estimatedFare.amount).toBeGreaterThan(0);
      expect(res.body.estimatedFare.currency).toBe('ARS');
    });

    it('debe responder 400 si falta el header Idempotency-Key', async () => {
      const clientId = getUniqueClientId();

      const res = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .send(validPayload);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_IDEMPOTENCY_KEY');
    });

    it('debe responder 400 con detalles si el payload es inválido', async () => {
      const clientId = getUniqueClientId();
      const idempotencyKey = getUniqueKey();

      const res = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          origin: { latitude: 200, longitude: 0, address: 'X' },
          destination: { latitude: 0, longitude: 0, address: 'Destino' },
          vehicleType: 'PATINETA',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details).toBeInstanceOf(Array);
      expect(res.body.details.length).toBeGreaterThan(0);
    });

    it('debe retornar la misma respuesta idempotente ante la misma Idempotency-Key (RNF-08)', async () => {
      const clientId = getUniqueClientId();
      const idempotencyKey = getUniqueKey();

      const res1 = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', idempotencyKey)
        .send(validPayload);

      const res2 = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', idempotencyKey)
        .send(validPayload);

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.id).toBe(res2.body.id);
    });

    it('debe responder 409 si el cliente intenta crear una segunda solicitud activa con otra clave', async () => {
      const clientId = getUniqueClientId();

      await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', getUniqueKey())
        .send(validPayload);

      const resConflict = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', getUniqueKey())
        .send(validPayload);

      expect(resConflict.status).toBe(409);
      expect(resConflict.body.code).toBe('ACTIVE_REQUEST_EXISTS');
    });

    it('debe consultar una solicitud existente mediante GET /api/v1/ride-requests/:requestId', async () => {
      const clientId = getUniqueClientId();
      const createRes = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', getUniqueKey())
        .send(validPayload);

      const requestId = createRes.body.id;

      const getRes = await request(app)
        .get(`/api/v1/ride-requests/${requestId}`)
        .set('x-user-id', clientId);

      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(requestId);
      expect(getRes.body.clientId).toBe(clientId);
    });

    it('debe responder 404 para solicitud inexistente', async () => {
      const res = await request(app)
        .get('/api/v1/ride-requests/req_inexistente_999')
        .set('x-user-id', 'client_1');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('RIDE_REQUEST_NOT_FOUND');
    });
  });

  // ==========================================================================
  // RF-5.2: Búsqueda de candidatos
  // ==========================================================================
  describe('RF-5.2: POST /api/v1/ride-requests/:requestId/candidates', () => {
    it('debe retornar lista de conductores candidatos ordenados por distancia', async () => {
      const clientId = getUniqueClientId();
      const createRes = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', getUniqueKey())
        .send(validPayload);

      const requestId = createRes.body.id;

      const candRes = await request(app)
        .post(`/api/v1/ride-requests/${requestId}/candidates`)
        .set('x-user-id', clientId)
        .send({ radiusKm: 5, maxCandidates: 3 });

      expect(candRes.status).toBe(200);
      expect(candRes.body.requestId).toBe(requestId);
      expect(candRes.body.candidatesCount).toBeGreaterThan(0);
      expect(candRes.body.candidates).toBeInstanceOf(Array);
      expect(candRes.body.candidates[0].vehicleType).toBe('AUTO');
      expect(candRes.body.candidates[0].driverId).toBeDefined();
    });

    it('debe responder 400 si las opciones de búsqueda son inválidas', async () => {
      const clientId = getUniqueClientId();
      const createRes = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', getUniqueKey())
        .send(validPayload);

      const res = await request(app)
        .post(`/api/v1/ride-requests/${createRes.body.id}/candidates`)
        .set('x-user-id', clientId)
        .send({ radiusKm: 999 });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================================================
  // RF-5.3: Oferta con vencimiento
  // ==========================================================================
  describe('RF-5.3: POST & GET /api/v1/ride-requests/:requestId/offers', () => {
    it('debe generar y despachar ofertas con TTL', async () => {
      const clientId = getUniqueClientId();
      const createRes = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', getUniqueKey())
        .send(validPayload);

      const requestId = createRes.body.id;

      const offerRes = await request(app)
        .post(`/api/v1/ride-requests/${requestId}/offers`)
        .set('x-user-id', clientId)
        .send({ driverIds: ['drv_101', 'drv_102'], ttlSeconds: 45 });

      expect(offerRes.status).toBe(201);
      expect(offerRes.body.offersSentCount).toBe(2);
      expect(offerRes.body.offers).toHaveLength(2);
      expect(offerRes.body.offers[0].status).toBe('PENDING');
      expect(offerRes.body.offers[0].ttlSeconds).toBe(45);
      expect(offerRes.body.offers[0].expiresAt).toBeDefined();
    });

    it('debe consultar las ofertas de una solicitud vía GET', async () => {
      const clientId = getUniqueClientId();
      const createRes = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', getUniqueKey())
        .send(validPayload);

      const requestId = createRes.body.id;

      await request(app)
        .post(`/api/v1/ride-requests/${requestId}/offers`)
        .set('x-user-id', clientId)
        .send({ driverIds: ['drv_101'], ttlSeconds: 30 });

      const getOffersRes = await request(app)
        .get(`/api/v1/ride-requests/${requestId}/offers`)
        .set('x-user-id', clientId);

      expect(getOffersRes.status).toBe(200);
      expect(getOffersRes.body.offersCount).toBe(1);
      expect(getOffersRes.body.offers[0].driverId).toBe('drv_101');
    });
  });

  // ==========================================================================
  // RF-5.4 & RF-5.5: Aceptar / Rechazar oferta & Asignación única
  // ==========================================================================
  describe('RF-5.4 & RF-5.5: Gestión de ofertas y Asignación única', () => {
    it('debe permitir a un conductor aceptar una oferta y quedar asignado (RF-5.4)', async () => {
      const clientId = getUniqueClientId();
      const createRes = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', getUniqueKey())
        .send(validPayload);

      const offerRes = await request(app)
        .post(`/api/v1/ride-requests/${createRes.body.id}/offers`)
        .set('x-user-id', clientId)
        .send({ driverIds: ['drv_101'], ttlSeconds: 60 });

      const offerId = offerRes.body.offers[0].id;

      const acceptRes = await request(app)
        .post(`/api/v1/offers/${offerId}/accept`)
        .set('x-driver-id', 'drv_101')
        .send();

      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body.action).toBe('ACCEPT');
      expect(acceptRes.body.status).toBe('ACCEPTED');
      expect(acceptRes.body.requestStatus).toBe('ASSIGNED');
      expect(acceptRes.body.assignedDriverId).toBe('drv_101');
    });

    it('debe permitir a un conductor rechazar una oferta (RF-5.4)', async () => {
      const clientId = getUniqueClientId();
      const createRes = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', getUniqueKey())
        .send(validPayload);

      const offerRes = await request(app)
        .post(`/api/v1/ride-requests/${createRes.body.id}/offers`)
        .set('x-user-id', clientId)
        .send({ driverIds: ['drv_101'], ttlSeconds: 60 });

      const offerId = offerRes.body.offers[0].id;

      const rejectRes = await request(app)
        .post(`/api/v1/offers/${offerId}/reject`)
        .set('x-driver-id', 'drv_101')
        .send();

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.action).toBe('REJECT');
      expect(rejectRes.body.status).toBe('REJECTED');
    });

    it('RF-5.5: Ante ofertas concurrentes, solo el primero asigna y el segundo recibe 409', async () => {
      const clientId = getUniqueClientId();
      const createRes = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', getUniqueKey())
        .send(validPayload);

      const offerRes = await request(app)
        .post(`/api/v1/ride-requests/${createRes.body.id}/offers`)
        .set('x-user-id', clientId)
        .send({ driverIds: ['drv_101', 'drv_102'], ttlSeconds: 60 });

      const [offer1, offer2] = offerRes.body.offers;

      // Primer conductor acepta
      const res1 = await request(app)
        .post(`/api/v1/offers/${offer1.id}/accept`)
        .set('x-driver-id', 'drv_101')
        .send();
      expect(res1.status).toBe(200);
      expect(res1.body.requestStatus).toBe('ASSIGNED');

      // Segundo conductor intenta aceptar la suya
      const res2 = await request(app)
        .post(`/api/v1/offers/${offer2.id}/accept`)
        .set('x-driver-id', 'drv_102')
        .send();

      expect(res2.status).toBe(409);
      expect(['REQUEST_ALREADY_ASSIGNED', 'OFFER_EXPIRED']).toContain(res2.body.code);
    });

    it('debe listar las ofertas dirigidas a un conductor en GET /api/v1/drivers/:driverId/offers', async () => {
      const clientId = getUniqueClientId();
      const createRes = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', getUniqueKey())
        .send(validPayload);

      await request(app)
        .post(`/api/v1/ride-requests/${createRes.body.id}/offers`)
        .set('x-user-id', clientId)
        .send({ driverIds: ['drv_101'], ttlSeconds: 60 });

      const driverOffersRes = await request(app)
        .get('/api/v1/drivers/drv_101/offers');

      expect(driverOffersRes.status).toBe(200);
      expect(driverOffersRes.body.driverId).toBe('drv_101');
      expect(driverOffersRes.body.count).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // RF-5.6: Cancelación previa de solicitud
  // ==========================================================================
  describe('RF-5.6: POST /api/v1/ride-requests/:requestId/cancel', () => {
    it('debe cancelar exitosamente una solicitud pendiente con motivo opcional', async () => {
      const clientId = getUniqueClientId();
      const createRes = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', getUniqueKey())
        .send(validPayload);

      const cancelRes = await request(app)
        .post(`/api/v1/ride-requests/${createRes.body.id}/cancel`)
        .set('x-user-id', clientId)
        .send({ reason: 'El pasajero no viajará' });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe('CANCELLED');
      expect(cancelRes.body.reason).toBe('El pasajero no viajará');
      expect(cancelRes.body.cancelledAt).toBeDefined();

      // Verificar que el estado persiste
      const getRes = await request(app)
        .get(`/api/v1/ride-requests/${createRes.body.id}`)
        .set('x-user-id', clientId);
      expect(getRes.body.status).toBe('CANCELLED');
    });

    it('no debe permitir cancelar una solicitud ya asignada a un conductor (409 Conflict)', async () => {
      const clientId = getUniqueClientId();
      const createRes = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', getUniqueKey())
        .send(validPayload);

      const offerRes = await request(app)
        .post(`/api/v1/ride-requests/${createRes.body.id}/offers`)
        .set('x-user-id', clientId)
        .send({ driverIds: ['drv_101'], ttlSeconds: 60 });

      // Conductor acepta y se asigna
      await request(app)
        .post(`/api/v1/offers/${offerRes.body.offers[0].id}/accept`)
        .set('x-driver-id', 'drv_101')
        .send();

      // Intento de cancelación previa
      const cancelRes = await request(app)
        .post(`/api/v1/ride-requests/${createRes.body.id}/cancel`)
        .set('x-user-id', clientId)
        .send();

      expect(cancelRes.status).toBe(409);
      expect(cancelRes.body.code).toBe('REQUEST_ALREADY_ASSIGNED');
    });

    it('no debe permitir cancelar una solicitud ya cancelada (409 Conflict)', async () => {
      const clientId = getUniqueClientId();
      const createRes = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', getUniqueKey())
        .send(validPayload);

      await request(app)
        .post(`/api/v1/ride-requests/${createRes.body.id}/cancel`)
        .set('x-user-id', clientId)
        .send();

      const secondCancel = await request(app)
        .post(`/api/v1/ride-requests/${createRes.body.id}/cancel`)
        .set('x-user-id', clientId)
        .send();

      expect(secondCancel.status).toBe(409);
      expect(secondCancel.body.code).toBe('REQUEST_ALREADY_CANCELLED');
    });
  });

  // ==========================================================================
  // RF-5.7: Sin disponibilidad
  // ==========================================================================
  describe('RF-5.7: Notificación de no disponibilidad', () => {
    it('debe responder 404 NO_DRIVERS_AVAILABLE si la búsqueda con radio muy bajo no encuentra candidatos', async () => {
      const clientId = getUniqueClientId();
      const createRes = await request(app)
        .post('/api/v1/ride-requests')
        .set('x-user-id', clientId)
        .set('Idempotency-Key', getUniqueKey())
        .send(validPayload);

      // drv_101 está a 1.2 km y drv_102 a 2.1 km. Si buscamos en radiusKm: 0.5, no habrá candidatos
      const candRes = await request(app)
        .post(`/api/v1/ride-requests/${createRes.body.id}/candidates`)
        .set('x-user-id', clientId)
        .send({ radiusKm: 0.5 });

      expect(candRes.status).toBe(404);
      expect(candRes.body.code).toBe('NO_DRIVERS_AVAILABLE');

      // Comprobar que el request pasa a estado NO_DRIVERS_AVAILABLE
      const getRes = await request(app)
        .get(`/api/v1/ride-requests/${createRes.body.id}`)
        .set('x-user-id', clientId);
      expect(getRes.body.status).toBe('NO_DRIVERS_AVAILABLE');
    });
  });
});

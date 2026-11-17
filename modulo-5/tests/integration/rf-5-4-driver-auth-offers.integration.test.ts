import request from 'supertest';
import { app, rideRequestService } from '../../src/index';

/**
 * Matriz Oficial de Casos de Prueba para RF-5.4: Aceptar o Rechazar Ofertas
 * 
 * Casos cubiertos con ID de trazabilidad:
 * - CP-5.4-01: Recorrido integrado: Crear, buscar, ofertar y aceptar un viaje.
 * - CP-5.4-02: Básico: Rechazar sin bloquear a los demás (A rechaza; B acepta).
 * - CP-5.4-05: Básico: Aceptar en el límite (variante L) y después del vencimiento (variante D) con reloj controlado.
 * - CP-5.4-06: Básico: Dejar vencer otra oferta sin consultarla antes; luego intentar rechazarla.
 * - CP-5.4-08: Seguridad: Con sesión de B intentar responder oferta dirigida a A con ID de A en payload.
 * - CP-5.4-11: Reintentos: Repetir una aceptación manteniendo asignación única.
 * - Casos de Autenticación M1: Token faltante, inválido y rol prohibido (CLIENTE).
 */
describe('RF-5.4: Casos de Prueba Oficiales — Aceptar o Rechazar Ofertas de Conductor', () => {
  const getUniqueClientId = () => `client_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const getUniqueKey = () => `key_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  const validPayload = {
    origin: {
      latitude: -34.6037,
      longitude: -58.3816,
      address: 'Obelisco, Buenos Aires'
    },
    destination: {
      latitude: -34.5885,
      longitude: -58.3974,
      address: 'Recoleta, Buenos Aires'
    },
    vehicleType: 'AUTO'
  };

  beforeAll(() => {
    process.env.M4_MOCK = 'true';
    rideRequestService.getM4ClientService().seedMockDrivers([
      { driverId: 'drv_101', latitude: -34.604, longitude: -58.382, vehicleType: 'AUTO', available: true, distanceKm: 1.2, rating: 4.8 },
      { driverId: 'drv_102', latitude: -34.607, longitude: -58.385, vehicleType: 'AUTO', available: true, distanceKm: 2.1, rating: 4.7 },
      { driverId: 'drv_201', latitude: -34.604, longitude: -58.382, vehicleType: 'MOTO', available: true, distanceKm: 1.5, rating: 4.6 },
      // Drivers de prueba para CP-5.4-02, CP-5.4-05, CP-5.4-06, CP-5.4-08, CP-5.4-11 y auth tests
      { driverId: 'drv_A_cp02', latitude: -34.605, longitude: -58.383, vehicleType: 'AUTO', available: true, distanceKm: 1.5, rating: 4.7 },
      { driverId: 'drv_B_cp02', latitude: -34.606, longitude: -58.384, vehicleType: 'AUTO', available: true, distanceKm: 1.8, rating: 4.6 },
      { driverId: 'drv_L_limit', latitude: -34.605, longitude: -58.383, vehicleType: 'AUTO', available: true, distanceKm: 1.5, rating: 4.7 },
      { driverId: 'drv_D_after', latitude: -34.606, longitude: -58.384, vehicleType: 'AUTO', available: true, distanceKm: 1.8, rating: 4.6 },
      { driverId: 'drv_vencido_06', latitude: -34.605, longitude: -58.383, vehicleType: 'AUTO', available: true, distanceKm: 1.5, rating: 4.7 },
      { driverId: 'drv_destinatario_A', latitude: -34.605, longitude: -58.383, vehicleType: 'AUTO', available: true, distanceKm: 1.5, rating: 4.7 },
      { driverId: 'drv_intruso_B', latitude: -34.606, longitude: -58.384, vehicleType: 'AUTO', available: true, distanceKm: 1.8, rating: 4.6 },
      { driverId: 'drv_reintento_11', latitude: -34.605, longitude: -58.383, vehicleType: 'AUTO', available: true, distanceKm: 1.5, rating: 4.7 },
      { driverId: 'drv_token_test', latitude: -34.605, longitude: -58.383, vehicleType: 'AUTO', available: true, distanceKm: 1.5, rating: 4.7 },
      { driverId: 'drv_m1_100', latitude: -34.606, longitude: -58.384, vehicleType: 'AUTO', available: true, distanceKm: 1.8, rating: 4.6 }
    ]);
  });

  afterAll(() => {
    delete process.env.M4_MOCK;
    rideRequestService.getM4ClientService().clearMockDrivers();
  });

  /**
   * Helper para crear una solicitud y despachar ofertas
   */
  async function createRequestAndOffers(driverIds: string[], ttlSeconds = 60) {
    const clientId = getUniqueClientId();
    const createRes = await request(app)
      .post('/api/v1/ride-requests')
      .set('x-user-id', clientId)
      .set('Idempotency-Key', getUniqueKey())
      .send(validPayload);

    expect(createRes.status).toBe(201);
    const requestId = createRes.body.id;

    const offersRes = await request(app)
      .post(`/api/v1/ride-requests/${requestId}/offers`)
      .set('x-user-id', clientId)
      .send({ driverIds, ttlSeconds });

    expect(offersRes.status).toBe(201);
    return { requestId, clientId, offers: offersRes.body.offers };
  }

  // ==========================================================================
  // CP-5.4-01: Recorrido integrado
  // ==========================================================================
  it('CP-5.4-01: Recorrido integrado — Crear, buscar, ofertar y aceptar un viaje', async () => {
    const clientId = getUniqueClientId();

    // 1. Como cliente, crear una solicitud y guardar su ID
    const createRes = await request(app)
      .post('/api/v1/ride-requests')
      .set('x-user-id', clientId)
      .set('Idempotency-Key', getUniqueKey())
      .send(validPayload);

    expect(createRes.status).toBe(201);
    const requestId = createRes.body.id;
    expect(requestId).toBeDefined();

    // 2. Buscar candidatos compatibles
    const candidatesRes = await request(app)
      .post(`/api/v1/ride-requests/${requestId}/candidates`)
      .set('x-user-id', clientId)
      .send({ radiusKm: 5, maxCandidates: 3 });

    expect(candidatesRes.status).toBe(200);
    expect(candidatesRes.body.candidatesCount).toBeGreaterThan(0);
    const selectedDriverId = candidatesRes.body.candidates[0].driverId;

    // 3. Enviar una oferta al conductor elegido y comprobar que le llega
    const sendOffersRes = await request(app)
      .post(`/api/v1/ride-requests/${requestId}/offers`)
      .set('x-user-id', clientId)
      .send({ driverIds: [selectedDriverId], ttlSeconds: 60 });

    expect(sendOffersRes.status).toBe(201);
    const offerId = sendOffersRes.body.offers[0].id;

    // Comprobar que la oferta le llega al conductor
    const driverInboxRes = await request(app)
      .get(`/api/v1/drivers/${selectedDriverId}/offers`)
      .set('x-driver-id', selectedDriverId);

    expect(driverInboxRes.status).toBe(200);
    const receivedOffer = driverInboxRes.body.offers.find((o: any) => o.id === offerId);
    expect(receivedOffer).toBeDefined();
    expect(receivedOffer.requestId).toBe(requestId);
    expect(receivedOffer.status).toBe('PENDING');

    // 4. Como ese conductor, aceptarla antes de vencer
    const acceptRes = await request(app)
      .post(`/api/v1/offers/${offerId}/accept`)
      .set('x-driver-id', selectedDriverId)
      .send();

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.action).toBe('ACCEPT');
    expect(acceptRes.body.status).toBe('ACCEPTED');
    expect(acceptRes.body.requestStatus).toBe('ASSIGNED');
    expect(acceptRes.body.assignedDriverId).toBe(selectedDriverId);

    // 5. Consultar la solicitud y la asignación resultante
    const finalRequestRes = await request(app)
      .get(`/api/v1/ride-requests/${requestId}`)
      .set('x-user-id', clientId);

    expect(finalRequestRes.status).toBe(200);
    expect(finalRequestRes.body.id).toBe(requestId);
    expect(finalRequestRes.body.status).toBe('ASSIGNED');
    expect(finalRequestRes.body.assignedDriverId).toBe(selectedDriverId);
  });

  // ==========================================================================
  // CP-5.4-02: Básico — Rechazar sin bloquear a los demás
  // ==========================================================================
  it('CP-5.4-02: Básico — Rechazar sin bloquear a los demás (A rechaza; B acepta)', async () => {
    const driverA = 'drv_A_cp02';
    const driverB = 'drv_B_cp02';

    // 1. Crear ofertas para A y B
    const { requestId, clientId, offers } = await createRequestAndOffers([driverA, driverB], 60);
    const offerA = offers.find((o: any) => o.driverId === driverA);
    const offerB = offers.find((o: any) => o.driverId === driverB);

    expect(offerA).toBeDefined();
    expect(offerB).toBeDefined();

    // 2. A rechaza su oferta
    const rejectRes = await request(app)
      .post(`/api/v1/offers/${offerA.id}/reject`)
      .set('x-driver-id', driverA)
      .send();

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.action).toBe('REJECT');
    expect(rejectRes.body.status).toBe('REJECTED');

    // La oferta de A queda rechazada y no lo asigna
    const checkOfferARes = await request(app)
      .get(`/api/v1/offers/${offerA.id}`)
      .set('x-user-id', clientId);
    expect(checkOfferARes.body.status).toBe('REJECTED');

    // 3. Después B acepta mientras su oferta sigue vigente
    const acceptBRes = await request(app)
      .post(`/api/v1/offers/${offerB.id}/accept`)
      .set('x-driver-id', driverB)
      .send();

    expect(acceptBRes.status).toBe(200);
    expect(acceptBRes.body.action).toBe('ACCEPT');
    expect(acceptBRes.body.status).toBe('ACCEPTED');
    expect(acceptBRes.body.assignedDriverId).toBe(driverB);

    // B queda asignado al viaje
    const finalRequestRes = await request(app)
      .get(`/api/v1/ride-requests/${requestId}`)
      .set('x-user-id', clientId);
    expect(finalRequestRes.body.status).toBe('ASSIGNED');
    expect(finalRequestRes.body.assignedDriverId).toBe(driverB);
  });

  // ==========================================================================
  // CP-5.4-05: Básico — Aceptar en el límite (variante L) y después del vencimiento (variante D)
  // ==========================================================================
  describe('CP-5.4-05: Básico — Aceptar en el límite y después del vencimiento (Reloj Controlado)', () => {
    let dateSpy: jest.SpyInstance;

    afterEach(() => {
      if (dateSpy) {
        dateSpy.mockRestore();
      }
    });

    it('Variante L: aceptar exactamente en el instante expiresAt cuenta como vencido según regla fijada (no acepta ni asigna)', async () => {
      const driverL = 'drv_L_limit';
      const ttlSeconds = 10;
      const { requestId, clientId, offers } = await createRequestAndOffers([driverL], ttlSeconds);
      const offerL = offers[0];

      const expiresAtExactMs = new Date(offerL.expiresAt).getTime();

      // Reloj controlado: simulamos el instante exacto expiresAt
      dateSpy = jest.spyOn(Date, 'now').mockReturnValue(expiresAtExactMs);

      const acceptRes = await request(app)
        .post(`/api/v1/offers/${offerL.id}/accept`)
        .set('x-driver-id', driverL)
        .send();

      // Regla acordada: si now >= expiresAt la oferta ya venció -> 409 OFFER_EXPIRED
      expect(acceptRes.status).toBe(409);
      expect(acceptRes.body.code).toBe('OFFER_EXPIRED');

      // Restaurar reloj para consultar estado final de la solicitud
      dateSpy.mockRestore();
      const finalRequest = await request(app)
        .get(`/api/v1/ride-requests/${requestId}`)
        .set('x-user-id', clientId);

      // No asigna al conductor
      expect(finalRequest.body.status).not.toBe('ASSIGNED');
    });

    it('Variante D: aceptar después de expiresAt siempre se rechaza por vencimiento y no asigna', async () => {
      const driverD = 'drv_D_after';
      const ttlSeconds = 10;
      const { requestId, clientId, offers } = await createRequestAndOffers([driverD], ttlSeconds);
      const offerD = offers[0];

      const afterExpiresMs = new Date(offerD.expiresAt).getTime() + 2000;

      // Reloj controlado: simulamos 2 segundos después de expiresAt
      dateSpy = jest.spyOn(Date, 'now').mockReturnValue(afterExpiresMs);

      const acceptRes = await request(app)
        .post(`/api/v1/offers/${offerD.id}/accept`)
        .set('x-driver-id', driverD)
        .send();

      // D: siempre se rechaza por vencimiento
      expect(acceptRes.status).toBe(409);
      expect(acceptRes.body.code).toBe('OFFER_EXPIRED');

      dateSpy.mockRestore();
      const finalRequest = await request(app)
        .get(`/api/v1/ride-requests/${requestId}`)
        .set('x-user-id', clientId);

      expect(finalRequest.body.status).not.toBe('ASSIGNED');
    });
  });

  // ==========================================================================
  // CP-5.4-06: Básico — Rechazar una oferta vencida
  // ==========================================================================
  it('CP-5.4-06: Básico — Dejar vencer otra oferta sin consultarla antes; luego intentar rechazarla', async () => {
    const driverVencido = 'drv_vencido_06';
    const ttlSeconds = 5;
    const { offers } = await createRequestAndOffers([driverVencido], ttlSeconds);
    const offer = offers[0];

    const afterExpirationMs = new Date(offer.expiresAt).getTime() + 5000;

    // Sin consultar antes la oferta, dejamos pasar el tiempo (reloj controlado)
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(afterExpirationMs);

    // Conductor intenta rechazar la oferta ya vencida
    const rejectRes = await request(app)
      .post(`/api/v1/offers/${offer.id}/reject`)
      .set('x-driver-id', driverVencido)
      .send();

    dateSpy.mockRestore();

    // Se informa que venció; no se registra como un rechazo recibido dentro de plazo
    expect(rejectRes.status).toBe(409);
    expect(rejectRes.body.code).toBe('OFFER_EXPIRED');
  });

  // ==========================================================================
  // CP-5.4-08: Seguridad — Otro conductor intenta responder
  // ==========================================================================
  it('CP-5.4-08: Seguridad — Con sesión de B, intentar aceptar una oferta dirigida a A, enviando además el ID de A en el pedido', async () => {
    const driverA = 'drv_destinatario_A';
    const driverB = 'drv_intruso_B';

    // Se crea oferta para el conductor A
    const { requestId, clientId, offers } = await createRequestAndOffers([driverA], 60);
    const offerA = offers[0];

    // Con sesión de B (x-driver-id: drv_intruso_B), intenta aceptar la oferta de A enviando driverId: 'drv_destinatario_A' en el body
    const hackRes = await request(app)
      .post(`/api/v1/offers/${offerA.id}/accept`)
      .set('x-driver-id', driverB)
      .send({ driverId: driverA });

    // Se deniega la respuesta: el ID enviado en el body no reemplaza a la identidad autenticada
    expect(hackRes.status).toBe(403);
    expect(hackRes.body.code).toBe('FORBIDDEN_ACCESS');

    // Comprobar que no cambió la asignación de la solicitud
    const finalRequest = await request(app)
      .get(`/api/v1/ride-requests/${requestId}`)
      .set('x-user-id', clientId);

    expect(finalRequest.body.status).not.toBe('ASSIGNED');
    expect(finalRequest.body.assignedDriverId).toBeFalsy();
  });

  // ==========================================================================
  // CP-5.4-11: Reintentos — Repetir una aceptación
  // ==========================================================================
  it('CP-5.4-11: Reintentos — Aceptar una oferta válida y repetir exactamente el mismo pedido', async () => {
    const driverRep = 'drv_reintento_11';
    const { requestId, clientId, offers } = await createRequestAndOffers([driverRep], 60);
    const offer = offers[0];

    // 1. Primer intento: Aceptar oferta válida
    const firstAcceptRes = await request(app)
      .post(`/api/v1/offers/${offer.id}/accept`)
      .set('x-driver-id', driverRep)
      .send();

    expect(firstAcceptRes.status).toBe(200);
    expect(firstAcceptRes.body.status).toBe('ACCEPTED');
    expect(firstAcceptRes.body.assignedDriverId).toBe(driverRep);

    // 2. Segundo intento: Repetir exactamente el mismo pedido
    const secondAcceptRes = await request(app)
      .post(`/api/v1/offers/${offer.id}/accept`)
      .set('x-driver-id', driverRep)
      .send();

    // El contrato define rechazar el reintento redundante con 409
    expect(secondAcceptRes.status).toBe(409);
    expect(['OFFER_ALREADY_RESPONDED', 'REQUEST_ALREADY_ASSIGNED']).toContain(secondAcceptRes.body.code);

    // 3. Consultar el estado y verificar que se mantiene una sola asignación
    const finalRequest = await request(app)
      .get(`/api/v1/ride-requests/${requestId}`)
      .set('x-user-id', clientId);

    expect(finalRequest.body.status).toBe('ASSIGNED');
    expect(finalRequest.body.assignedDriverId).toBe(driverRep);
  });

  // ==========================================================================
  // Casos Complementarios: Validación de Token M1 y Rol de Conductor
  // ==========================================================================
  describe('Autenticación M1 y Rol Conductor', () => {
    it('debe rechazar con 401 MISSING_TOKEN si no se incluye header de autenticación', async () => {
      const { offers } = await createRequestAndOffers(['drv_token_test']);
      const offerId = offers[0].id;

      const res = await request(app)
        .post(`/api/v1/offers/${offerId}/accept`)
        .send();

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('MISSING_TOKEN');
    });

    it('debe rechazar con 401 INVALID_TOKEN si el token JWT no es válido', async () => {
      const { offers } = await createRequestAndOffers(['drv_token_test']);
      const offerId = offers[0].id;

      const res = await request(app)
        .post(`/api/v1/offers/${offerId}/accept`)
        .set('Authorization', 'Bearer invalid_token_xyz')
        .send();

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_TOKEN');
    });

    it('debe rechazar con 403 FORBIDDEN_ROLE si el usuario autenticado tiene rol CLIENTE', async () => {
      const { offers } = await createRequestAndOffers(['drv_token_test']);
      const offerId = offers[0].id;

      const res = await request(app)
        .post(`/api/v1/offers/${offerId}/accept`)
        .set('Authorization', 'Bearer forbidden_role_token')
        .send();

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('debe permitir aceptar con token JWT válido de M1 con rol CONDUCTOR', async () => {
      const { offers } = await createRequestAndOffers(['drv_m1_100']);
      const offerId = offers[0].id;

      const res = await request(app)
        .post(`/api/v1/offers/${offerId}/accept`)
        .set('Authorization', 'Bearer valid_driver_token')
        .send();

      // valid_driver_token resuelve a userId: 'drv_m1_100' con rol CONDUCTOR
      // La oferta fue creada para drv_m1_100, por lo que la aceptación debe ser exitosa
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACCEPTED');
      expect(res.body.assignedDriverId).toBe('drv_m1_100');
    });
  });
});

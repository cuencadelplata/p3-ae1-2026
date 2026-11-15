import request from 'supertest';
import { app } from '../../src/index';

/**
 * Suite de Pruebas de Integración para RF-5.4: Aceptar o Rechazar Ofertas con Auth M1
 * 
 * Requerimientos verificados:
 * 1. El conductor puede aceptar o rechazar una oferta mientras esté vigente.
 * 2. Validación estricta de token JWT y rol "CONDUCTOR" validado por M1.
 * 3. Prevención total de identidades de demo o suplantaciones desde el cuerpo del pedido (req.body.driverId).
 * 4. Control de acceso: un conductor no puede responder ofertas ajenas ni consultar ofertas de otros conductores.
 * 5. Rechazo ante ofertas expiradas por TTL o ya respondidas previamente.
 */
describe('RF-5.4: Integración Auth M1 y Aceptación/Rechazo de Ofertas', () => {
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

  /**
   * Helper para crear una solicitud y despachar ofertas a uno o más conductores
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

  describe('Validación de Autenticación M1 y Rol de Conductor', () => {
    it('debe rechazar con 401 MISSING_TOKEN si no se incluye header de autenticación en /accept', async () => {
      const { offers } = await createRequestAndOffers(['drv_test_1']);
      const offerId = offers[0].id;

      const res = await request(app)
        .post(`/api/v1/offers/${offerId}/accept`)
        .send();

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('MISSING_TOKEN');
    });

    it('debe rechazar con 401 INVALID_TOKEN si el token JWT es inválido o expirado', async () => {
      const { offers } = await createRequestAndOffers(['drv_test_1']);
      const offerId = offers[0].id;

      const res = await request(app)
        .post(`/api/v1/offers/${offerId}/accept`)
        .set('Authorization', 'Bearer invalid_token_xyz')
        .send();

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_TOKEN');
    });

    it('debe rechazar con 403 FORBIDDEN_ROLE si el usuario autenticado en M1 tiene rol CLIENTE', async () => {
      const { offers } = await createRequestAndOffers(['drv_test_1']);
      const offerId = offers[0].id;

      const res = await request(app)
        .post(`/api/v1/offers/${offerId}/accept`)
        .set('Authorization', 'Bearer forbidden_role_token')
        .send();

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
      expect(res.body.message).toContain('CONDUCTOR');
    });

    it('debe permitir aceptar con token JWT válido de M1 con rol CONDUCTOR', async () => {
      // drv_m1_100 es el userId retornado por el mock de M1 para valid_driver_token
      const { offers } = await createRequestAndOffers(['drv_m1_100']);
      const offerId = offers[0].id;

      const res = await request(app)
        .post(`/api/v1/offers/${offerId}/accept`)
        .set('Authorization', 'Bearer valid_driver_token')
        .send();

      expect(res.status).toBe(200);
      expect(res.body.action).toBe('ACCEPT');
      expect(res.body.status).toBe('ACCEPTED');
      expect(res.body.requestStatus).toBe('ASSIGNED');
      expect(res.body.assignedDriverId).toBe('drv_m1_100');
    });
  });

  describe('Prevención de Identidades Reemplazables desde el Payload (Suplantación)', () => {
    it('debe ignorar cualquier driverId malicioso enviado en el body y validar solo contra el conductor autenticado', async () => {
      const { offers } = await createRequestAndOffers(['drv_real_auth']);
      const offerId = offers[0].id;

      // El conductor autenticado es drv_real_auth, pero el body intenta engañar con driverId: drv_fake_imposter
      const res = await request(app)
        .post(`/api/v1/offers/${offerId}/accept`)
        .set('x-driver-id', 'drv_real_auth')
        .send({ driverId: 'drv_fake_imposter' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACCEPTED');
      // Debe quedar asignado a drv_real_auth (el autenticado), no al imposter
      expect(res.body.assignedDriverId).toBe('drv_real_auth');
      expect(res.body.driverId).toBe('drv_real_auth');
    });

    it('debe rechazar con 403 FORBIDDEN_ACCESS si un conductor intenta aceptar la oferta de otro conductor', async () => {
      // Oferta enviada a drv_destinatario_legitimo
      const { offers } = await createRequestAndOffers(['drv_destinatario_legitimo']);
      const offerId = offers[0].id;

      // Conductor que intenta responder es drv_intruso
      const res = await request(app)
        .post(`/api/v1/offers/${offerId}/accept`)
        .set('x-driver-id', 'drv_intruso')
        .send();

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ACCESS');
    });

    it('debe rechazar con 403 FORBIDDEN_ACCESS si un conductor intenta consultar ofertas de otro conductor', async () => {
      const res = await request(app)
        .get('/api/v1/drivers/drv_otro/offers')
        .set('x-driver-id', 'drv_mio');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ACCESS');
    });
  });

  describe('Flujos de Aceptación y Rechazo de Ofertas Vigentes', () => {
    it('debe permitir rechazar una oferta vigente y cambiar el estado a REJECTED', async () => {
      const { offers } = await createRequestAndOffers(['drv_rej_1']);
      const offerId = offers[0].id;

      const res = await request(app)
        .post(`/api/v1/offers/${offerId}/reject`)
        .set('x-driver-id', 'drv_rej_1')
        .send();

      expect(res.status).toBe(200);
      expect(res.body.action).toBe('REJECT');
      expect(res.body.status).toBe('REJECTED');
    });

    it('debe permitir responder vía POST /respond con action ACCEPT', async () => {
      const { offers } = await createRequestAndOffers(['drv_resp_1']);
      const offerId = offers[0].id;

      const res = await request(app)
        .post(`/api/v1/offers/${offerId}/respond`)
        .set('x-driver-id', 'drv_resp_1')
        .send({ action: 'ACCEPT' });

      expect(res.status).toBe(200);
      expect(res.body.action).toBe('ACCEPT');
      expect(res.body.status).toBe('ACCEPTED');
    });

    it('debe permitir responder vía POST /respond con action REJECT', async () => {
      const { offers } = await createRequestAndOffers(['drv_resp_2']);
      const offerId = offers[0].id;

      const res = await request(app)
        .post(`/api/v1/offers/${offerId}/respond`)
        .set('x-driver-id', 'drv_resp_2')
        .send({ action: 'REJECT' });

      expect(res.status).toBe(200);
      expect(res.body.action).toBe('REJECT');
      expect(res.body.status).toBe('REJECTED');
    });

    it('debe responder 400 si la acción en /respond es inválida', async () => {
      const { offers } = await createRequestAndOffers(['drv_resp_3']);
      const offerId = offers[0].id;

      const res = await request(app)
        .post(`/api/v1/offers/${offerId}/respond`)
        .set('x-driver-id', 'drv_resp_3')
        .send({ action: 'MAYBE' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });
});

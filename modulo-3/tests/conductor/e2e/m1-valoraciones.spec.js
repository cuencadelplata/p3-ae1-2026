const { test, expect } = require('@playwright/test');
const {
  M1_URL,
  ensureM1Healthy,
  crearSesionM1
} = require('../../helpers/m1Client');

const CONDUCTOR_URL = (
  process.env.CONDUCTOR_URL || 'http://127.0.0.1:5000'
).replace(/\/$/, '');

/**
 * Integración real M1 ↔ M3:
 * 1) Alta + login + validación de identidad en M1 (sin mocks / sin Prism)
 * 2) Valoración en M3 usando los userId canónicos de M1
 */
test.describe('M1 real + M3 valoraciones (sin mocks)', () => {
  test.describe.configure({ timeout: 60_000 });

  test('M1 /health responde OK', async () => {
    const health = await ensureM1Healthy();
    expect(String(health.status || health.Status || '')).toMatch(/ok/i);
  });

  test('registra conductor y cliente en M1, valida JWT y registra valoración en M3', async ({
    request
  }) => {
    const conductor = await crearSesionM1('CONDUCTOR', {
      nombre: 'Carlos',
      apellido: 'E2E'
    });
    const cliente = await crearSesionM1('CLIENTE', {
      nombre: 'Ana',
      apellido: 'Pasajera'
    });

    expect(conductor.role).toBe('CONDUCTOR');
    expect(cliente.role).toBe('CLIENTE');
    expect(conductor.token).toBeTruthy();
    expect(cliente.token).toBeTruthy();
    expect(conductor.userId).toMatch(/^\d+$/);
    expect(cliente.userId).toMatch(/^\d+$/);
    expect(conductor.userId).not.toBe(cliente.userId);

    const payload = {
      conductorId: conductor.userId,
      evaluadoId: cliente.userId,
      valoracion: 5,
      comentario: `Valoración real M1→M3 (${conductor.email} → ${cliente.email})`,
      viajeId: `viaje_m1_${Date.now()}`
    };

    const postRes = await request.post(
      `${CONDUCTOR_URL}/api/conductor/valoraciones?conductorId=${conductor.userId}`,
      { data: payload }
    );
    expect(postRes.status()).toBe(201);

    const created = await postRes.json();
    expect(created.evaluadorId).toBe(conductor.userId);
    expect(created.evaluadoId).toBe(cliente.userId);
    expect(created.valoracion).toBe(5);
    expect(created.comentario).toContain('Valoración real M1→M3');

    const getRes = await request.get(
      `${CONDUCTOR_URL}/api/conductor/valoraciones?conductorId=${conductor.userId}`
    );
    expect(getRes.status()).toBe(200);

    const lista = await getRes.json();
    expect(Array.isArray(lista)).toBe(true);
    expect(
      lista.some(
        (v) =>
          v.evaluadorId === conductor.userId &&
          v.evaluadoId === cliente.userId &&
          v.valoracion === 5
      )
    ).toBe(true);
  });

  test('usuarioId solo en query ya no identifica al conductor (contrato M3)', async ({
    request
  }) => {
    await ensureM1Healthy();
    const response = await request.get(
      `${CONDUCTOR_URL}/api/conductor/valoraciones?usuarioId=123`
    );
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/evaluadorId|conductorId/i);
  });

  test(`documenta base M1 usada: ${M1_URL}`, async () => {
    // Smoke de configuración: falla temprano si alguien apunta a Prism/mock.
    expect(M1_URL).not.toContain('prism');
    expect(M1_URL).toMatch(/^https?:\/\//);
  });
});

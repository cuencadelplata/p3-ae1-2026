const { test, expect } = require('@playwright/test');
const { crearSesionM1 } = require('../../helpers/m1Client');

/**
 * Integración real M1 → M3 (sin mocks, sin Prism):
 *  1) Se registra un CONDUCTOR en M1 y se obtiene su JWT.
 *  2) Se envían los datos del conductor a M3 con ese JWT.
 *  3) M3 valida el token contra M1 (/auth/validar-identidad-y-rol) y usa el userId de M1.
 *  4) Se verifica el conductor por la API de M3 (alta, habilitación, disponibilidad).
 */
test.describe('M1 real → M3 alta de conductor (sin mocks)', () => {
  test.describe.configure({ timeout: 60_000 });

  test('registra conductor en M1, lo da de alta en M3 con su JWT y lo opera por la API', async ({ request }) => {
    const m1 = await crearSesionM1('CONDUCTOR', { nombre: 'Lucía', apellido: 'Alta M3' });
    expect(m1.role).toBe('CONDUCTOR');

    const auth = { Authorization: `Bearer ${m1.token}` };

    // Alta en M3: sin usuarioID en el body, M3 lo toma de M1
    const alta = await request.post('/api/conductores', {
      headers: auth,
      data: { ciudad: 'Corrientes', tipovehiculo: 'auto', licenciaId: 'lic_e2e_1', vehiculoId: 'veh_e2e_1' }
    });
    expect(alta.status()).toBe(201);
    const creado = await alta.json();
    expect(creado).toMatchObject({
      usuarioID: m1.userId,
      ciudad: 'Corrientes',
      tipovehiculo: 'auto',
      habilitado: 'pendiente'
    });

    // Lectura por ID
    const get = await request.get(`/api/conductores/${m1.userId}`);
    expect(get.status()).toBe(200);
    expect((await get.json()).usuarioID).toBe(m1.userId);

    // RF 3.1: habilitación persistida en la capa BD (cache miss -> db, luego cache)
    const hab = await request.get(`/api/conductores/${m1.userId}/habilitado`);
    expect(hab.status()).toBe(200);
    expect(await hab.json()).toMatchObject({ usuarioID: m1.userId, habilitado: 'pendiente' });

    const activar = await request.put(`/api/conductores/${m1.userId}/habilitado`, {
      data: { habilitado: 'activo' }
    });
    expect(activar.status()).toBe(200);
    expect(await activar.json()).toEqual({
      usuarioID: m1.userId,
      habilitado: 'activo',
      habilitadoAnterior: 'pendiente',
      eventoEmitido: true
    });

    const estado = await request.get(`/api/conductor/${m1.userId}/estado`);
    expect(estado.status()).toBe(200);
    expect(await estado.json()).toMatchObject({ usuarioID: m1.userId, habilitado: true, estado: 'activo' });

    // RF 3.3: disponibilidad (heartbeat en Redis)
    const disp = await request.put(`/api/conductores/${m1.userId}/disponible`, { data: { disponible: true } });
    expect(disp.status()).toBe(200);
    expect(await disp.json()).toMatchObject({ usuarioID: m1.userId, disponible: true, eventoEmitido: true });
  });

  test('rechaza un JWT inválido (401) validándolo contra M1', async ({ request }) => {
    const res = await request.post('/api/conductores', {
      headers: { Authorization: 'Bearer token.que.no.existe' },
      data: { ciudad: 'Posadas', tipovehiculo: 'moto' }
    });
    expect(res.status()).toBe(401);
  });

  test('rechaza un usuario de M1 con rol CLIENTE (403)', async ({ request }) => {
    const cliente = await crearSesionM1('CLIENTE', { nombre: 'Ana', apellido: 'Cliente' });
    const res = await request.post('/api/conductores', {
      headers: { Authorization: `Bearer ${cliente.token}` },
      data: { ciudad: 'Posadas', tipovehiculo: 'moto' }
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toContain('CONDUCTOR');
  });

  test('rechaza un usuarioID que no coincide con el usuario autenticado en M1 (403)', async ({ request }) => {
    const m1 = await crearSesionM1('CONDUCTOR');
    const res = await request.post('/api/conductores', {
      headers: { Authorization: `Bearer ${m1.token}` },
      data: { usuarioID: 'otro_usuario_999', ciudad: 'Posadas', tipovehiculo: 'moto' }
    });
    expect(res.status()).toBe(403);
  });
});

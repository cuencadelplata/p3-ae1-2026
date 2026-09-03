const { test, expect } = require('@playwright/test');

test.describe('M3 - API Conductores & Valoraciones (E2E Backend)', () => {

  test('GET /health debe retornar estado ok del módulo', async ({ request, baseURL }) => {
    const backendUrl = process.env.BACKEND_URL || (baseURL && baseURL.includes(':4000') ? 'http://localhost:5000' : '');
    const targetUrl = backendUrl ? `${backendUrl}/health` : '/health';
    const response = await request.get(targetUrl);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.module).toBe('M3-Conductor');
  });

  test('GET /api/conductores debe devolver la lista de conductores', async ({ request }) => {
    const response = await request.get('/api/conductores');
    expect(response.status()).toBe(200);

    const conductores = await response.json();
    expect(Array.isArray(conductores)).toBe(true);
    expect(conductores.length).toBeGreaterThan(0);

    const conductor = conductores[0];
    expect(conductor).toHaveProperty('usuarioID');
    expect(conductor).toHaveProperty('ciudad');
    expect(conductor).toHaveProperty('tipovehiculo');
  });

  test('GET /api/conductores/:id debe devolver un conductor existente', async ({ request }) => {
    const response = await request.get('/api/conductores/cond_001');
    expect(response.status()).toBe(200);

    const conductor = await response.json();
    expect(conductor.usuarioID).toBe('cond_001');
    expect(conductor.ciudad).toBe('Corrientes');
    expect(conductor.tipovehiculo).toBe('auto');
  });

  test('GET /api/conductores/:id debe responder 404 para ID inexistente', async ({ request }) => {
    const response = await request.get('/api/conductores/cond_no_existe_9999');
    expect(response.status()).toBe(404);

    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('no encontrado');
  });

  test('POST /api/conductores debe crear un conductor nuevo', async ({ request }) => {
    const uniqueId = `cond_api_test_${Date.now()}`;
    const newDriver = {
      usuarioID: uniqueId,
      ciudad: 'Posadas',
      tipovehiculo: 'moto',
      licenciaId: 'lic_mision_777',
      vehiculoId: 'veh_pos_999',
      habilitado: 'activo',
      estado_conexion: 'conectado'
    };

    const response = await request.post('/api/conductores', {
      data: newDriver
    });

    expect(response.status()).toBe(201);
    const created = await response.json();
    expect(created.usuarioID).toBe(uniqueId);
    expect(created.ciudad).toBe('Posadas');

    // Verificar que se puede recuperar inmediatamente
    const getResponse = await request.get(`/api/conductores/${uniqueId}`);
    expect(getResponse.status()).toBe(200);
    const fetched = await getResponse.json();
    expect(fetched.usuarioID).toBe(uniqueId);
  });

  test('POST /api/conductores con cuerpo vacío debe retornar 400', async ({ request }) => {
    const response = await request.post('/api/conductores', {
      data: {}
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('GET /api/conductor/valoraciones debe retornar las valoraciones de un conductor', async ({ request }) => {
    const response = await request.get('/api/conductor/valoraciones?usuarioId=cond_001');
    expect(response.status()).toBe(200);

    const valoraciones = await response.json();
    expect(Array.isArray(valoraciones)).toBe(true);
  });

  test('GET /api/conductor/valoraciones sin usuarioId debe retornar 400', async ({ request }) => {
    const response = await request.get('/api/conductor/valoraciones');
    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('POST /api/conductor/valoraciones debe registrar una calificación válida', async ({ request }) => {
    const payload = {
      usuarioId: 'pasajero_tester_1',
      conductorId: 'cond_001',
      valoracion: 4,
      comentario: 'Viaje seguro y a tiempo'
    };

    const response = await request.post('/api/conductor/valoraciones?usuarioId=cond_001', {
      data: payload
    });

    expect(response.status()).toBe(201);
    const created = await response.json();
    expect(created.valoracion).toBe(4);
    expect(created.comentario).toBe('Viaje seguro y a tiempo');
    expect(created.conductorId).toBe('cond_001');
  });

  test('POST /api/conductor/valoraciones con calificación fuera de rango (1-5) debe retornar 400', async ({ request }) => {
    const payload = {
      usuarioId: 'pasajero_tester_invalid',
      conductorId: 'cond_001',
      valoracion: 10, // Inválido (> 5)
      comentario: 'Puntaje ilegal'
    };

    const response = await request.post('/api/conductor/valoraciones?usuarioId=cond_001', {
      data: payload
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('entre 1 y 5');
  });

});

const { test, expect } = require('@playwright/test');
const net = require('net');

function sendRedisCommand(...args) {
  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const payload =
    `*${args.length}\r\n` +
    args
      .map((arg) => {
        const str = String(arg);
        return `$${Buffer.byteLength(str)}\r\n${str}\r\n`;
      })
      .join('');

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.write(payload);
    });
    let response = '';
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
      socket.end();
    });
    socket.on('end', () => resolve(response));
    socket.on('error', (err) => reject(err));
    socket.setTimeout(3000, () => {
      socket.destroy(new Error('Redis command timeout'));
    });
  });
}

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

  test('GET /api/conductor/:id/estado debe responder estado del conductor', async ({ request }) => {
    const response = await request.get('/api/conductor/cond_001/estado');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.usuarioID).toBe('cond_001');
    expect(body.habilitado).toBe(true);
    expect(body.disponible).toBe(true);
  });

  test('GET /api/conductor/:id/habilitado y /disponible deben responder con la misma estructura', async ({ request }) => {
    const resHab = await request.get('/api/conductor/cond_001/habilitado');
    expect(resHab.status()).toBe(200);
    const bodyHab = await resHab.json();
    expect(bodyHab.usuarioID).toBe('cond_001');
    expect(typeof bodyHab.habilitado).toBe('boolean');
    expect(typeof bodyHab.disponible).toBe('boolean');

    const resDisp = await request.get('/api/conductor/cond_001/disponible');
    expect(resDisp.status()).toBe(200);
    const bodyDisp = await resDisp.json();
    expect(bodyDisp.usuarioID).toBe('cond_001');
    expect(typeof bodyDisp.disponible).toBe('boolean');
  });

  test('GET /api/conductor/:id/estado responde 404 si no existe', async ({ request }) => {
    const response = await request.get('/api/conductor/cond_inexistente_99/estado');
    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test.describe('RF 3.1 y RF 3.3 - Endpoints /api/conductores/:id/habilitado y /disponible + Resiliencia Redis', () => {

    test('GET /api/conductores/:id/habilitado devuelve usuarioID, habilitado y origen db en cache miss y cache en hit, y 404 para inexistente', async ({ request }) => {
      // Asegurar cache miss inicial eliminando la clave de caché en Redis
      await sendRedisCommand('DEL', 'conductor:cond_002:habilitado');

      const missRes = await request.get('/api/conductores/cond_002/habilitado');
      expect(missRes.status()).toBe(200);
      const missBody = await missRes.json();
      expect(missBody).toEqual({
        usuarioID: 'cond_002',
        habilitado: 'activo',
        origen: 'db'
      });

      // La segunda lectura debe venir desde la caché de Redis
      const hitRes = await request.get('/api/conductores/cond_002/habilitado');
      expect(hitRes.status()).toBe(200);
      const hitBody = await hitRes.json();
      expect(hitBody).toEqual({
        usuarioID: 'cond_002',
        habilitado: 'activo',
        origen: 'cache'
      });

      // Conductor inexistente -> 404
      const notFoundRes = await request.get('/api/conductores/cond_no_existe_9999/habilitado');
      expect(notFoundRes.status()).toBe(404);
      const notFoundBody = await notFoundRes.json();
      expect(notFoundBody).toHaveProperty('error');
      expect(notFoundBody.error).toContain('no encontrado');
    });

    test('PUT /api/conductores/:id/habilitado actualiza BD y caché, controla eventoEmitido y valida 400 / 404', async ({ request }) => {
      // Estado inicial conocido para cond_003
      await request.put('/api/conductores/cond_003/habilitado', {
        data: { habilitado: 'pendiente' }
      });

      // Cambio real de estado: pendiente -> suspendido (eventoEmitido: true)
      const changeRes = await request.put('/api/conductores/cond_003/habilitado', {
        data: { habilitado: 'suspendido', motivo: 'Documentación vencida E2E' }
      });
      expect(changeRes.status()).toBe(200);
      const changeBody = await changeRes.json();
      expect(changeBody).toEqual({
        usuarioID: 'cond_003',
        habilitado: 'suspendido',
        habilitadoAnterior: 'pendiente',
        eventoEmitido: true
      });

      // Verificar write-through en caché
      const getCached = await request.get('/api/conductores/cond_003/habilitado');
      expect(getCached.status()).toBe(200);
      expect(await getCached.json()).toEqual({
        usuarioID: 'cond_003',
        habilitado: 'suspendido',
        origen: 'cache'
      });

      // Repetir el mismo estado: suspendido -> suspendido (eventoEmitido: false)
      const repeatRes = await request.put('/api/conductores/cond_003/habilitado', {
        data: { habilitado: 'suspendido' }
      });
      expect(repeatRes.status()).toBe(200);
      const repeatBody = await repeatRes.json();
      expect(repeatBody).toEqual({
        usuarioID: 'cond_003',
        habilitado: 'suspendido',
        habilitadoAnterior: 'suspendido',
        eventoEmitido: false
      });

      // Estado inválido -> 400
      const invalidRes = await request.put('/api/conductores/cond_003/habilitado', {
        data: { habilitado: 'invalido_xyz' }
      });
      expect(invalidRes.status()).toBe(400);
      const invalidBody = await invalidRes.json();
      expect(invalidBody).toHaveProperty('error');

      // Conductor inexistente -> 404
      const notFoundRes = await request.put('/api/conductores/cond_inexistente_9999/habilitado', {
        data: { habilitado: 'activo' }
      });
      expect(notFoundRes.status()).toBe(404);
      const notFoundBody = await notFoundRes.json();
      expect(notFoundBody).toHaveProperty('error');
      expect(notFoundBody.error).toContain('no encontrado');

      // Restaurar estado original de cond_003
      await request.put('/api/conductores/cond_003/habilitado', {
        data: { habilitado: 'pendiente' }
      });
    });

    test('GET y PUT /api/conductores/:id/disponible actualizan disponibilidad, detectan cambios vs heartbeats y validan 400', async ({ request }) => {
      // Asegurar que cond_002 parte en disponible: false
      await request.put('/api/conductores/cond_002/disponible', {
        data: { disponible: false }
      });

      const initialGet = await request.get('/api/conductores/cond_002/disponible');
      expect(initialGet.status()).toBe(200);
      expect(await initialGet.json()).toEqual({
        usuarioID: 'cond_002',
        disponible: false
      });

      // Cambio de false a true -> eventoEmitido: true
      const toTrueRes = await request.put('/api/conductores/cond_002/disponible', {
        data: { disponible: true }
      });
      expect(toTrueRes.status()).toBe(200);
      expect(await toTrueRes.json()).toEqual({
        usuarioID: 'cond_002',
        disponible: true,
        disponibleAnterior: false,
        eventoEmitido: true
      });

      // Verificar con GET
      const afterTrueGet = await request.get('/api/conductores/cond_002/disponible');
      expect(afterTrueGet.status()).toBe(200);
      expect(await afterTrueGet.json()).toEqual({
        usuarioID: 'cond_002',
        disponible: true
      });

      // Heartbeat repitiendo true -> eventoEmitido: false
      const heartbeatTrueRes = await request.put('/api/conductores/cond_002/disponible', {
        data: { disponible: true }
      });
      expect(heartbeatTrueRes.status()).toBe(200);
      expect(await heartbeatTrueRes.json()).toEqual({
        usuarioID: 'cond_002',
        disponible: true,
        disponibleAnterior: true,
        eventoEmitido: false
      });

      // Cambio de true a false -> eventoEmitido: true
      const toFalseRes = await request.put('/api/conductores/cond_002/disponible', {
        data: { disponible: false }
      });
      expect(toFalseRes.status()).toBe(200);
      expect(await toFalseRes.json()).toEqual({
        usuarioID: 'cond_002',
        disponible: false,
        disponibleAnterior: true,
        eventoEmitido: true
      });

      // Heartbeat repitiendo false -> eventoEmitido: false
      const heartbeatFalseRes = await request.put('/api/conductores/cond_002/disponible', {
        data: { disponible: false }
      });
      expect(heartbeatFalseRes.status()).toBe(200);
      expect(await heartbeatFalseRes.json()).toEqual({
        usuarioID: 'cond_002',
        disponible: false,
        disponibleAnterior: false,
        eventoEmitido: false
      });

      // Valor no booleano -> 400
      const invalidRes = await request.put('/api/conductores/cond_002/disponible', {
        data: { disponible: 'si' }
      });
      expect(invalidRes.status()).toBe(400);
      const invalidBody = await invalidRes.json();
      expect(invalidBody).toHaveProperty('error');
      expect(invalidBody.error).toContain('booleano');
    });

    test('opera con resiliencia cuando Redis cae (fallback a BD en memoria) e invalida/recarga caché al recuperarse', async ({ request }) => {
      // 1. Con Redis UP, dejar cond_003 en habilitado='activo' y disponible=true en caché y BD
      const setupHab = await request.put('/api/conductores/cond_003/habilitado', {
        data: { habilitado: 'activo' }
      });
      expect(setupHab.status()).toBe(200);

      const setupDisp = await request.put('/api/conductores/cond_003/disponible', {
        data: { disponible: true }
      });
      expect(setupDisp.status()).toBe(200);

      const preCheckHab = await request.get('/api/conductores/cond_003/habilitado');
      expect(await preCheckHab.json()).toEqual({
        usuarioID: 'cond_003',
        habilitado: 'activo',
        origen: 'cache'
      });

      try {
        // 2. Simular caída de Redis pausando comandos
        await sendRedisCommand('CLIENT', 'PAUSE', '10000');

        // Primera lectura detecta el fallo de Redis, activa markDown y responde desde BD
        const fallbackGetHab = await request.get('/api/conductores/cond_003/habilitado');
        expect(fallbackGetHab.status()).toBe(200);
        expect(await fallbackGetHab.json()).toEqual({
          usuarioID: 'cond_003',
          habilitado: 'activo',
          origen: 'db'
        });

        // Actualizar habilitado mientras Redis está caído (se escribe en BD en memoria, Redis queda con 'activo' viejo)
        const putHabDown = await request.put('/api/conductores/cond_003/habilitado', {
          data: { habilitado: 'suspendido' }
        });
        expect(putHabDown.status()).toBe(200);
        expect(await putHabDown.json()).toEqual({
          usuarioID: 'cond_003',
          habilitado: 'suspendido',
          habilitadoAnterior: 'activo',
          eventoEmitido: true
        });

        // Lectura de habilitado con Redis caído devuelve el nuevo valor desde BD
        const getHabWhileDown = await request.get('/api/conductores/cond_003/habilitado');
        expect(getHabWhileDown.status()).toBe(200);
        expect(await getHabWhileDown.json()).toEqual({
          usuarioID: 'cond_003',
          habilitado: 'suspendido',
          origen: 'db'
        });

        // Actualizar disponibilidad mientras Redis está caído (se persiste en BD en memoria)
        const putDispDown = await request.put('/api/conductores/cond_003/disponible', {
          data: { disponible: false }
        });
        expect(putDispDown.status()).toBe(200);
        expect(await putDispDown.json()).toEqual({
          usuarioID: 'cond_003',
          disponible: false,
          disponibleAnterior: true,
          eventoEmitido: true
        });

        const getDispWhileDown = await request.get('/api/conductores/cond_003/disponible');
        expect(getDispWhileDown.status()).toBe(200);
        expect(await getDispWhileDown.json()).toEqual({
          usuarioID: 'cond_003',
          disponible: false
        });
      } finally {
        // 3. Recuperar Redis
        await sendRedisCommand('CLIENT', 'UNPAUSE');
      }

      // 4. Esperar a que redisHealth detecte PING -> PONG, invalide la caché obsoleta y recargue desde BD
      await expect
        .poll(
          async () => {
            const res = await request.get('/api/conductores/cond_003/habilitado');
            return await res.json();
          },
          { timeout: 15000, intervals: [200, 300, 500] }
        )
        .toEqual({
          usuarioID: 'cond_003',
          habilitado: 'suspendido',
          origen: 'cache'
        });

      // La disponibilidad también fue invalidada en Redis y refleja false
      const dispAfterRecovery = await request.get('/api/conductores/cond_003/disponible');
      expect(dispAfterRecovery.status()).toBe(200);
      expect(await dispAfterRecovery.json()).toEqual({
        usuarioID: 'cond_003',
        disponible: false
      });

      // Restaurar estado base
      await request.put('/api/conductores/cond_003/habilitado', {
        data: { habilitado: 'pendiente' }
      });
      await request.put('/api/conductores/cond_001/disponible', {
        data: { disponible: true }
      });
    });

  });

});

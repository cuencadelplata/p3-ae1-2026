import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import axios from 'axios';
import { execSync, spawn, type ChildProcess } from 'child_process';
import { resolve } from 'path';

let API_URL = '';
const M8_URL = process.env.M8_URL ?? 'http://host.docker.internal:3103';
const M8_TEST_URL = process.env.M8_TEST_URL ?? 'http://localhost:3103';
const PROJECT_ROOT = resolve(__dirname, '../../../');
let containerId: string | null = null;
let mockM8Process: ChildProcess | null = null;

describe('E2E Tests - Docker Container', () => {
  beforeAll(async () => {
    if (!process.env.M8_URL) {
      mockM8Process = spawn(process.execPath, ['rf-6.1-6.2-6.3/mock-m8/server.js'], {
        cwd: PROJECT_ROOT,
        env: { ...process.env, PORT: '3103' },
        stdio: 'ignore',
      });

      let attempts = 0;
      while (attempts < 30) {
        try {
          await axios.get('http://localhost:3103/health', { timeout: 1000 });
          break;
        } catch {
          if (mockM8Process.exitCode !== null) {
            throw new Error('El mock M8 no pudo iniciarse');
          }
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      if (attempts >= 30) {
        throw new Error('El mock M8 no respondió dentro de 30 segundos');
      }
    }

    console.log('Construyendo imagen de Docker...');
    try {
      execSync('docker build -f Dockerfile -t m6-viajes:e2e .', {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
      });
      console.log('Imagen de Docker construida exitosamente');
    } catch (error) {
      console.error('Error al construir la imagen de Docker:', error);
      throw error;
    }

    console.log('Iniciando contenedor de Docker...');
    try {
      const result = execSync(`docker run -d --network m6_viajes_default --add-host host.docker.internal:host-gateway -e DB_HOST=tripdb -e DB_PORT=5432 -e DB_USER=m6 -e DB_PASSWORD=m6pass -e DB_NAME=tripdb -e REDIS_URL=redis://redis:6379 -e RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672 -e M8_URL=${M8_URL} -p 127.0.0.1::3000 m6-viajes:e2e`, {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      }).trim();
      containerId = result;
      const publishedPort = execSync(`docker port ${containerId} 3000/tcp`, {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      }).trim().match(/:(\d+)$/)?.[1];
      if (!publishedPort) {
        throw new Error('No se pudo determinar el puerto publicado por Docker');
      }
      API_URL = `http://127.0.0.1:${publishedPort}/api`;
      console.log(`Contenedor iniciado con ID: ${containerId}`);

      // Esperar a que el contenedor esté listo (máximo 30 segundos)
      let attempts = 0;
      const maxAttempts = 30;
      while (attempts < maxAttempts) {
        try {
          await axios.get(`http://127.0.0.1:${publishedPort}/health`, { timeout: 2000 });
          console.log('Contenedor está listo');
          break;
        } catch {
          attempts++;
          console.log(`Esperando al contenedor... (intento ${attempts}/${maxAttempts})`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      if (attempts >= maxAttempts) {
        throw new Error('El contenedor no se preparó dentro de 30 segundos');
      }
    } catch (error) {
      console.error('Error al iniciar el contenedor de Docker:', error);
      throw error;
    }
  }, 180000);

  it('M8 devuelve el mismo QR ante generación repetida y valida single-use', async () => {
    const tripId = `idempotency-${Date.now()}`;
    const [first, retry] = await Promise.all([
      axios.post(`${M8_TEST_URL}/qr`, { tripId }),
      axios.post(`${M8_TEST_URL}/qr`, { tripId }),
    ]);

    expect(first.data.token).toBe(retry.data.token);
    expect(first.data.expiresAt).toBe(retry.data.expiresAt);

    const validation = await axios.post(`${M8_TEST_URL}/qr/validate`, {
      tripId,
      token: first.data.token,
    });
    expect(validation.status).toBe(200);
    expect(validation.data).toEqual({ valid: true });

    try {
      await axios.post(`${M8_TEST_URL}/qr/validate`, { tripId, token: first.data.token });
      throw new Error('El segundo consumo debería ser rechazado');
    } catch (error: any) {
      expect(error.response?.status).toBe(409);
    }
  });

  afterAll(async () => {
    if (containerId) {
      console.log('Deteniendo contenedor de Docker...');
      try {
        execSync(`docker stop ${containerId}`, { stdio: 'ignore' });
        execSync(`docker rm ${containerId}`, { stdio: 'ignore' });
        console.log('Contenedor detenido y eliminado');
      } catch (error) {
        console.error('Error al detener el contenedor:', error);
      }
    }

    if (mockM8Process && mockM8Process.exitCode === null) {
      mockM8Process.kill();
    }
  });

  it('RF-6.1: POST /viajes - Solicitar Viaje', async () => {
    const response = await axios.post(`${API_URL}/viajes`, {
      clienteId: 'cliente-123',
      origen: 'Calle A',
      destino: 'Calle B',
    });

    expect(response.status).toBe(201);
    expect(response.data).toHaveProperty('id');
    expect(response.data).toHaveProperty('clienteId', 'cliente-123');
    expect(response.data).toHaveProperty('estado', 'SOLICITADO');
    expect(response.data.codigoVerificacion).toBeNull();
  });

  it('RF-6.1: POST /viajes - Múltiples viajes tienen códigos e IDs únicos', async () => {
    const viaje1 = await axios.post(`${API_URL}/viajes`, {
      clienteId: 'cliente-1',
      origen: 'A',
      destino: 'B',
    });

    const viaje2 = await axios.post(`${API_URL}/viajes`, {
      clienteId: 'cliente-2',
      origen: 'C',
      destino: 'D',
    });

    expect(viaje1.data.id).not.toBe(viaje2.data.id);
    expect(viaje1.data.codigoVerificacion).toBeNull();
    expect(viaje2.data.codigoVerificacion).toBeNull();
  });

  it('RF-6.2: POST /viajes/:id/asignar - Asignar Conductor', async () => {
    const viaje = await axios.post(`${API_URL}/viajes`, {
      clienteId: 'cliente-asign',
      origen: 'Inicio',
      destino: 'Final',
    });

    const response = await axios.post(`${API_URL}/viajes/${viaje.data.id}/asignar`, {
      conductorId: 'conductor-456',
    });

    expect(response.status).toBe(200);
    expect(response.data.viaje.estado).toBe('CONDUCTOR_EN_CAMINO');
    expect(response.data.viaje.conductorId).toBe('conductor-456');
  });

  it('RF-6.2: POST /viajes/:id/asignar - No se puede asignar si no está SOLICITADO', async () => {
    const viaje = await axios.post(`${API_URL}/viajes`, {
      clienteId: 'cliente-double',
      origen: 'X',
      destino: 'Y',
    });

    // Asignar primera vez (funciona)
    const firstAssign = await axios.post(`${API_URL}/viajes/${viaje.data.id}/asignar`, {
      conductorId: 'conductor-1',
    });
    expect(firstAssign.data.viaje.estado).toBe('CONDUCTOR_EN_CAMINO');

    // Intentar asignar de nuevo (debe fallar)
    try {
      await axios.post(`${API_URL}/viajes/${viaje.data.id}/asignar`, {
        conductorId: 'conductor-2',
      });
      throw new Error('Debe lanzar un error 400');
    } catch (error: any) {
      expect(error.response?.status).toBe(400);
    }
  });

  it('RF-6.3: POST /viajes/:id/iniciar - Iniciar viaje con código de verificación válido', async () => {
    const viaje = await axios.post(`${API_URL}/viajes`, {
      clienteId: 'cliente-start',
      origen: 'P1',
      destino: 'P2',
    });

    // Asignar conductor
    await axios.post(`${API_URL}/viajes/${viaje.data.id}/asignar`, {
      conductorId: 'conductor-start',
    });

    // Registrar arribo
    const arribo = await axios.put(`${API_URL}/viajes/${viaje.data.id}/arribo`, {}).catch((error: any) => {
      throw new Error(`Arribo devolvió ${error.response?.status}: ${JSON.stringify(error.response?.data)}`);
    });
    expect(arribo.data.viaje.estado).toBe('ARRIBADO');
    const codigoVerificacion = arribo.data.qr.token;

    // Iniciar con código válido
    const response = await axios.post(`${API_URL}/viajes/${viaje.data.id}/iniciar`, {
      codigoVerificacion,
    });

    expect(response.status).toBe(200);
    expect(response.data.viaje.estado).toBe('EN_CURSO');
  }, 30000);

  it('RF-6.3: POST /viajes/:id/iniciar - Rechazar código de verificación inválido', async () => {
    const viaje = await axios.post(`${API_URL}/viajes`, {
      clienteId: 'cliente-invalid',
      origen: 'P3',
      destino: 'P4',
    });

    // Asignar conductor
    await axios.post(`${API_URL}/viajes/${viaje.data.id}/asignar`, {
      conductorId: 'conductor-invalid',
    });

    // Registrar arribo
    const arribo = await axios.put(`${API_URL}/viajes/${viaje.data.id}/arribo`, {});
    expect(arribo.data.viaje.estado).toBe('ARRIBADO');

    // Intentar con código inválido
    try {
      await axios.post(`${API_URL}/viajes/${viaje.data.id}/iniciar`, {
        codigoVerificacion: 'CODIGOINCORRECTO',
      });
      throw new Error('Debe lanzar un error 401');
    } catch (error: any) {
      expect(error.response?.status).toBe(401);
    }
  }, 30000);

  it('Flujo completo de viaje: Solicitar -> Asignar -> Arribo -> Iniciar', async () => {
    // Paso 1: Solicitar Viaje
    const viaje = await axios.post(`${API_URL}/viajes`, {
      clienteId: 'cliente-flow',
      origen: 'Origen',
      destino: 'Destino',
    });

    expect(viaje.status).toBe(201);
    expect(viaje.data.estado).toBe('SOLICITADO');
    // Paso 2: Asignar Conductor
    const asignacion = await axios.post(`${API_URL}/viajes/${viaje.data.id}/asignar`, {
      conductorId: 'conductor-flow',
    });

    expect(asignacion.status).toBe(200);
    expect(asignacion.data.viaje.estado).toBe('CONDUCTOR_EN_CAMINO');

    // Paso 3: Registrar Arribo
    const arribo = await axios.put(`${API_URL}/viajes/${viaje.data.id}/arribo`, {});

    expect(arribo.status).toBe(200);
    expect(arribo.data.viaje.estado).toBe('ARRIBADO');
    const codigoVerificacion = arribo.data.qr.token;

    // Paso 4: Iniciar Viaje
    const inicio = await axios.post(`${API_URL}/viajes/${viaje.data.id}/iniciar`, {
      codigoVerificacion,
    });

    expect(inicio.status).toBe(200);
    expect(inicio.data.viaje.estado).toBe('EN_CURSO');
  }, 30000);

  it('GET /viajes debe retornar no encontrado para un viaje inexistente', async () => {
    try {
      await axios.get(`${API_URL}/viajes/invalid-id`);
      throw new Error('Debe lanzar un error 404');
    } catch (error: any) {
      expect(error.response?.status).toBe(404);
    }
  });

  it('Asignación concurrente de conductor - solo la primera tiene éxito', async () => {
    // Crear un viaje
    const viaje = await axios.post(`${API_URL}/viajes`, {
      clienteId: 'cliente-concurrent',
      origen: 'Concurrente1',
      destino: 'Concurrente2',
    });

    const viajeId = viaje.data.id;

    // Intentar asignar dos conductores de forma concurrente
    const promises = [
      axios.post(`${API_URL}/viajes/${viajeId}/asignar`, {
        conductorId: 'conductor-first',
      }),
      axios.post(`${API_URL}/viajes/${viajeId}/asignar`, {
        conductorId: 'conductor-second',
      }),
    ];

    const results = await Promise.allSettled(promises);

    // Uno debe tener éxito, uno debe fallar
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const successResult = fulfilled[0] as PromiseFulfilledResult<any>;
    const failResult = rejected[0] as PromiseRejectedResult;

    expect(successResult.value.status).toBe(200);
    expect(successResult.value.data.viaje.conductorId).toBeDefined();
    expect(failResult.reason.response?.status).toBe(400);
  });
});
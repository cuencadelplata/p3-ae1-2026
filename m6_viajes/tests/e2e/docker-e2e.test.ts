import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import axios from 'axios';
import { execSync, spawn } from 'child_process';
import { resolve } from 'path';

const API_URL = 'http://localhost:3000/api';
const PROJECT_ROOT = resolve(__dirname, '../../');
let containerId: string | null = null;

describe('E2E Tests - Docker Container', () => {
  beforeAll(async () => {
    console.log('Construyendo imagen de Docker...');
    try {
      execSync('docker build -t m6-viajes:e2e .', {
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
      const result = execSync('docker run -d -p 3000:3000 m6-viajes:e2e', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      }).trim();
      containerId = result;
      console.log(`Contenedor iniciado con ID: ${containerId}`);

      // Esperar a que el contenedor esté listo (máximo 30 segundos)
      let attempts = 0;
      const maxAttempts = 30;
      while (attempts < maxAttempts) {
        try {
          await axios.get('http://localhost:3000/health', { timeout: 2000 });
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
  }, 60000);

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
    expect(response.data).toHaveProperty('codigoVerificacion');
    expect(response.data).toHaveProperty('qrCode');
    expect(response.data.qrCode).toMatch(/^data:image\/png;base64,/);
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
    expect(viaje1.data.codigoVerificacion).not.toBe(viaje2.data.codigoVerificacion);
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

    const codigoVerificacion = viaje.data.codigoVerificacion;

    // Asignar conductor
    await axios.post(`${API_URL}/viajes/${viaje.data.id}/asignar`, {
      conductorId: 'conductor-start',
    });

    // Registrar arribo
    const arribo = await axios.put(`${API_URL}/viajes/${viaje.data.id}/arribo`, {});
    expect(arribo.data.viaje.estado).toBe('ARRIBADO');

    // Iniciar con código válido
    const response = await axios.post(`${API_URL}/viajes/${viaje.data.id}/iniciar`, {
      codigoVerificacion,
    });

    expect(response.status).toBe(200);
    expect(response.data.viaje.estado).toBe('EN_CURSO');
  });

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
  });

  it('Flujo completo de viaje: Solicitar -> Asignar -> Arribo -> Iniciar', async () => {
    // Paso 1: Solicitar Viaje
    const viaje = await axios.post(`${API_URL}/viajes`, {
      clienteId: 'cliente-flow',
      origen: 'Origen',
      destino: 'Destino',
    });

    expect(viaje.status).toBe(201);
    expect(viaje.data.estado).toBe('SOLICITADO');
    const codigoVerificacion = viaje.data.codigoVerificacion;

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

    // Paso 4: Iniciar Viaje
    const inicio = await axios.post(`${API_URL}/viajes/${viaje.data.id}/iniciar`, {
      codigoVerificacion,
    });

    expect(inicio.status).toBe(200);
    expect(inicio.data.viaje.estado).toBe('EN_CURSO');
  });

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

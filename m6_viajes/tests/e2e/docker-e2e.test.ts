import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import axios from 'axios';
import { execSync, spawn } from 'child_process';
import { resolve } from 'path';

const API_URL = 'http://localhost:3000/api';
const PROJECT_ROOT = resolve(__dirname, '../../');
let containerId: string | null = null;

describe('E2E Tests - Docker Container', () => {
  beforeAll(async () => {
    console.log('🐳 Building Docker image...');
    try {
      execSync('docker build -t m6-viajes:e2e .', {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
      });
      console.log('✅ Docker image built successfully');
    } catch (error) {
      console.error('❌ Failed to build Docker image:', error);
      throw error;
    }

    console.log('🚀 Starting Docker container...');
    try {
      const result = execSync('docker run -d -p 3000:3000 m6-viajes:e2e', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      }).trim();
      containerId = result;
      console.log(`✅ Container started with ID: ${containerId}`);

      // Wait for container to be ready (max 30 seconds)
      let attempts = 0;
      const maxAttempts = 30;
      while (attempts < maxAttempts) {
        try {
          await axios.get('http://localhost:3000/health', { timeout: 2000 });
          console.log('✅ Container is healthy and ready');
          break;
        } catch {
          attempts++;
          console.log(`⏳ Waiting for container... (attempt ${attempts}/${maxAttempts})`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      if (attempts >= maxAttempts) {
        throw new Error('Container did not become ready within 30 seconds');
      }
    } catch (error) {
      console.error('❌ Failed to start Docker container:', error);
      throw error;
    }
  }, 60000);

  afterAll(async () => {
    if (containerId) {
      console.log('🛑 Stopping Docker container...');
      try {
        execSync(`docker stop ${containerId}`, { stdio: 'ignore' });
        execSync(`docker rm ${containerId}`, { stdio: 'ignore' });
        console.log('✅ Container stopped and removed');
      } catch (error) {
        console.error('⚠️ Failed to stop container:', error);
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

  it('RF-6.1: POST /viajes - Multiple trips have unique codes and IDs', async () => {
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

  it('RF-6.2: POST /viajes/:id/asignar - Assign Conductor', async () => {
    const viaje = await axios.post(`${API_URL}/viajes`, {
      clienteId: 'cliente-asign',
      origen: 'Start',
      destino: 'End',
    });

    const response = await axios.post(`${API_URL}/viajes/${viaje.data.id}/asignar`, {
      conductorId: 'conductor-456',
    });

    expect(response.status).toBe(200);
    expect(response.data.viaje.estado).toBe('CONDUCTOR_EN_CAMINO');
    expect(response.data.viaje.conductorId).toBe('conductor-456');
  });

  it('RF-6.2: POST /viajes/:id/asignar - Cannot assign if not SOLICITADO', async () => {
    const viaje = await axios.post(`${API_URL}/viajes`, {
      clienteId: 'cliente-double',
      origen: 'X',
      destino: 'Y',
    });

    // Assign first time (works)
    const firstAssign = await axios.post(`${API_URL}/viajes/${viaje.data.id}/asignar`, {
      conductorId: 'conductor-1',
    });
    expect(firstAssign.data.viaje.estado).toBe('CONDUCTOR_EN_CAMINO');

    // Try to assign again (should fail)
    try {
      await axios.post(`${API_URL}/viajes/${viaje.data.id}/asignar`, {
        conductorId: 'conductor-2',
      });
      throw new Error('Should have thrown 400');
    } catch (error: any) {
      expect(error.response?.status).toBe(400);
    }
  });

  it('RF-6.3: POST /viajes/:id/iniciar - Start trip with valid verification code', async () => {
    const viaje = await axios.post(`${API_URL}/viajes`, {
      clienteId: 'cliente-start',
      origen: 'P1',
      destino: 'P2',
    });

    const codigoVerificacion = viaje.data.codigoVerificacion;

    // Assign conductor
    await axios.post(`${API_URL}/viajes/${viaje.data.id}/asignar`, {
      conductorId: 'conductor-start',
    });

    // Register arribo
    const arribo = await axios.put(`${API_URL}/viajes/${viaje.data.id}/arribo`, {});
    expect(arribo.data.viaje.estado).toBe('ARRIBADO');

    // Start with valid code
    const response = await axios.post(`${API_URL}/viajes/${viaje.data.id}/iniciar`, {
      codigoVerificacion,
    });

    expect(response.status).toBe(200);
    expect(response.data.viaje.estado).toBe('EN_CURSO');
  });

  it('RF-6.3: POST /viajes/:id/iniciar - Reject invalid verification code', async () => {
    const viaje = await axios.post(`${API_URL}/viajes`, {
      clienteId: 'cliente-invalid',
      origen: 'P3',
      destino: 'P4',
    });

    // Assign conductor
    await axios.post(`${API_URL}/viajes/${viaje.data.id}/asignar`, {
      conductorId: 'conductor-invalid',
    });

    // Register arribo
    const arribo = await axios.put(`${API_URL}/viajes/${viaje.data.id}/arribo`, {});
    expect(arribo.data.viaje.estado).toBe('ARRIBADO');

    // Try with invalid code
    try {
      await axios.post(`${API_URL}/viajes/${viaje.data.id}/iniciar`, {
        codigoVerificacion: 'WRONGCODE',
      });
      throw new Error('Should have thrown 401');
    } catch (error: any) {
      expect(error.response?.status).toBe(401);
    }
  });

  it('Full trip flow: Solicitar -> Asignar -> Arribo -> Iniciar', async () => {
    // Step 1: Solicitar Viaje
    const viaje = await axios.post(`${API_URL}/viajes`, {
      clienteId: 'cliente-flow',
      origen: 'Origin',
      destino: 'Destination',
    });

    expect(viaje.status).toBe(201);
    expect(viaje.data.estado).toBe('SOLICITADO');
    const codigoVerificacion = viaje.data.codigoVerificacion;

    // Step 2: Asignar Conductor
    const asignacion = await axios.post(`${API_URL}/viajes/${viaje.data.id}/asignar`, {
      conductorId: 'conductor-flow',
    });

    expect(asignacion.status).toBe(200);
    expect(asignacion.data.viaje.estado).toBe('CONDUCTOR_EN_CAMINO');

    // Step 3: Registrar Arribo
    const arribo = await axios.put(`${API_URL}/viajes/${viaje.data.id}/arribo`, {});

    expect(arribo.status).toBe(200);
    expect(arribo.data.viaje.estado).toBe('ARRIBADO');

    // Step 4: Iniciar Viaje
    const inicio = await axios.post(`${API_URL}/viajes/${viaje.data.id}/iniciar`, {
      codigoVerificacion,
    });

    expect(inicio.status).toBe(200);
    expect(inicio.data.viaje.estado).toBe('EN_CURSO');
  });

  it('GET /viajes should return not found for non-existent trip', async () => {
    try {
      await axios.get(`${API_URL}/viajes/invalid-id`);
      throw new Error('Should have thrown 404');
    } catch (error: any) {
      expect(error.response?.status).toBe(404);
    }
  });

  it('Concurrent conductor assignment - only first succeeds', async () => {
    // Create a trip
    const viaje = await axios.post(`${API_URL}/viajes`, {
      clienteId: 'cliente-concurrent',
      origen: 'Concurrent1',
      destino: 'Concurrent2',
    });

    const viajeId = viaje.data.id;

    // Try to assign two conductors concurrently
    const promises = [
      axios.post(`${API_URL}/viajes/${viajeId}/asignar`, {
        conductorId: 'conductor-first',
      }),
      axios.post(`${API_URL}/viajes/${viajeId}/asignar`, {
        conductorId: 'conductor-second',
      }),
    ];

    const results = await Promise.allSettled(promises);

    // One should succeed, one should fail
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

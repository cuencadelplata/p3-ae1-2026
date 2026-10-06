import { crearViaje, post } from './helpers.js';
import { execFileSync } from 'node:child_process';

describe('RF-6.4 - Finalización del viaje en Docker', () => {
  it('registra la finalización y autoriza el pago mediante el simulador', async () => {
    const viajeId = await crearViaje({
      clienteId: `E2E-64-${Date.now()}`,
      iniciar: true,
    });

    const { response, body } = await post(`/api/viajes/${viajeId}/finalizacion`, {
      origen: { latitude: 0, longitude: 0 },
      destino: { latitude: 0, longitude: 0.01 },
      tipoVehiculo: 'auto',
      horaFin: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      metodoPago: 'tarjeta',
    });

    expect(response.status).toBe(200);
    expect(body.viaje.estado).toBe('completado');
    expect(body.viaje.total).toBe(927.5);
    expect(body.viaje.tiempoMinutos).toBe(3);
    expect(body.viaje.distanciaKm).toBe(1.11);
    expect(body.viaje.metricasEstimadas).toBe(true);
    expect(body.metricasEstimadas).toBe(true);
    expect(body.fuenteMetrica).toBe('M4');
    expect(body.paymentId).toBe(`PAY-${viajeId}`);
  });

  it('rechaza finalizar un viaje ya completado', async () => {
    const viajeId = await crearViaje({ clienteId: `E2E-64-no-iniciado-${Date.now()}` });

    const { response, body } = await post(`/api/viajes/${viajeId}/finalizacion`, {
      origen: { latitude: -34.6, longitude: -58.4 },
      destino: { latitude: -34.7, longitude: -58.5 },
      tipoVehiculo: 'auto',
      horaFin: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      metodoPago: 'efectivo',
    });

    expect(response.status).toBe(400);
    expect(body.error).toContain('estado SOLICITADO');
  });

  it('keeps API alive while simulator is stopped', async () => {
    const viajeId = await crearViaje({
      clienteId: `E2E-64-outage-${Date.now()}`,
      iniciar: true,
    });

    execFileSync('docker', ['compose', 'stop', 'simulador']);
    try {
      const apiUrl = process.env.E2E_API_URL ?? 'http://127.0.0.1:3002';
      let health: Response | undefined;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          health = await fetch(`${apiUrl}/health`);
          if (health.status === 200) break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      expect(health?.status).toBe(200);

      const { response } = await post(`/api/viajes/${viajeId}/finalizacion`, {
        origen: { latitude: 0, longitude: 0 },
        destino: { latitude: 0, longitude: 0.01 },
        tipoVehiculo: 'auto',
        horaFin: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        metodoPago: 'tarjeta',
      });
      expect(response.status).toBe(503);
      expect(await health?.json()).toEqual({ status: 'ok' });
    } finally {
      execFileSync('docker', ['compose', 'start', 'simulador']);
    }
  });
});

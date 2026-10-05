import { crearViaje, post } from './helpers.js';
import { execFileSync } from 'node:child_process';

describe('RF-6.7 - Historial de transiciones en Docker', () => {
  it('devuelve las transiciones reales del ciclo de vida, incluida la finalización', async () => {
    const viajeId = await crearViaje({
      clienteId: `E2E-67-${Date.now()}`,
      iniciar: true,
    });

    const finalizacion = await post(`/api/viajes/${viajeId}/finalizacion`, {
      origen: { latitude: -34.6, longitude: -58.4 },
      destino: { latitude: -34.7, longitude: -58.5 },
      tipoVehiculo: 'auto',
      horaFin: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      metodoPago: 'tarjeta',
    });

    expect(finalizacion.response.status).toBe(200);

    const response = await fetch(
      `${process.env.E2E_API_URL ?? 'http://127.0.0.1:3000'}/api/viajes/${viajeId}/historial-transiciones`,
    );
    const body = await response.json() as {
      historial: Array<{ from: string; to: string; timestamp: string; detalle?: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.historial).toHaveLength(4);
    expect(body.historial[3]).toMatchObject({
      from: 'en curso',
      to: 'completado',
      detalle: 'Finalización del viaje',
    });
    expect(Number.isNaN(Date.parse(body.historial[3].timestamp))).toBe(false);
  });

  it('devuelve un historial vacío para un viaje recién creado', async () => {
    const viajeId = await crearViaje({ clienteId: `E2E-67-vacio-${Date.now()}` });

    const response = await fetch(
      `${process.env.E2E_API_URL ?? 'http://127.0.0.1:3002'}/api/viajes/${viajeId}/historial-transiciones`,
    );
    const body = await response.json() as { historial: unknown[] };

    expect(response.status).toBe(200);
    expect(body.historial).toEqual([]);
  });

  it('keeps M6 alive while PostgreSQL is stopped', async () => {
    const viajeId = await crearViaje({ clienteId: `E2E-67-db-outage-${Date.now()}` });
    const apiUrl = process.env.E2E_API_URL ?? 'http://127.0.0.1:3002';

    execFileSync('docker', ['compose', 'stop', 'tripdb']);
    try {
      const response = await fetch(`${apiUrl}/api/viajes/${viajeId}/historial-transiciones`);
      const health = await fetch(`${apiUrl}/health`);

      expect(response.status).toBe(503);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: 'ok' });
    } finally {
      execFileSync('docker', ['compose', 'start', 'tripdb']);
    }
  });
});

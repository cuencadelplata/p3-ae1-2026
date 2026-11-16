import { execFileSync } from 'node:child_process';
import { crearViaje, datosFinalizacion, post } from './helpers.js';

const apiUrl = process.env.E2E_API_URL ?? 'http://127.0.0.1:3002';

describe('RF-6.7 - Historial de transiciones en Docker', () => {
  it('devuelve el ciclo de vida completo, desde la solicitud hasta la finalización', async () => {
    const viajeId = await crearViaje({ clienteId: `E2E-67-${Date.now()}`, iniciar: true });

    const finalizacion = await post(`/api/viajes/${viajeId}/finalizacion`, datosFinalizacion());
    expect(finalizacion.response.status).toBe(200);

    const response = await fetch(`${apiUrl}/api/viajes/${viajeId}/historial-transiciones`);
    const body = await response.json() as {
      historial: Array<{ from: string | null; to: string; timestamp: string; detalle?: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.historial.map(({ from, to }) => [from, to])).toEqual([
      [null, 'solicitado'],
      ['solicitado', 'conductor en camino'],
      ['conductor en camino', 'arribado'],
      ['arribado', 'en curso'],
      ['en curso', 'completado'],
    ]);
    expect(body.historial[4].detalle).toBe('Finalización del viaje');
    expect(body.historial.every(({ timestamp }) => !Number.isNaN(Date.parse(timestamp)))).toBe(true);
  });

  it('un viaje recién creado tiene sólo la transición de solicitud', async () => {
    const viajeId = await crearViaje({ clienteId: `E2E-67-nuevo-${Date.now()}` });

    const response = await fetch(`${apiUrl}/api/viajes/${viajeId}/historial-transiciones`);
    const body = await response.json() as { historial: Array<{ from: string | null; to: string }> };

    expect(response.status).toBe(200);
    expect(body.historial).toHaveLength(1);
    expect(body.historial[0]).toMatchObject({ from: null, to: 'solicitado' });
  });

  it('TripDB rechaza modificar o borrar el historial registrado', async () => {
    const viajeId = await crearViaje({ clienteId: `E2E-67-inmutable-${Date.now()}` });
    const psql = (sql: string) => execFileSync(
      'docker',
      ['compose', 'exec', '-T', 'tripdb', 'psql', '-U', 'm6', '-d', 'tripdb', '-v', 'ON_ERROR_STOP=1', '-c', sql],
      { stdio: 'pipe' },
    );

    expect(() => psql(`UPDATE viaje_transiciones SET detalle = 'x' WHERE viaje_id = '${viajeId}'`)).toThrow(/solo inserción/);
    expect(() => psql(`DELETE FROM viajes WHERE id = '${viajeId}'`)).toThrow(/solo inserción/);
  });

  it('keeps M6 alive while PostgreSQL is stopped', async () => {
    const viajeId = await crearViaje({ clienteId: `E2E-67-db-outage-${Date.now()}` });

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

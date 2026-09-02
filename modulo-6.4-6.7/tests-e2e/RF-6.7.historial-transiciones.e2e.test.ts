import { crearViaje, post } from './helpers.js';

describe('RF-6.7 - Historial de transiciones en Docker', () => {
  it('devuelve la transición real de finalización mediante el endpoint de historial', async () => {
    const viajeId = `E2E-67-${Date.now()}`;
    await crearViaje({ id: viajeId, estado: 'en curso' });

    const finalizacion = await post(`/api/viajes/${viajeId}/finalizacion`, {
      tiempoMinutos: 42,
      distanciaKm: 18.5,
      horaFin: '2026-09-01T10:42:00Z',
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
    expect(body.historial).toHaveLength(1);
    expect(body.historial[0]).toMatchObject({
      from: 'en curso',
      to: 'completado',
      detalle: 'Finalización del viaje',
    });
    expect(Number.isNaN(Date.parse(body.historial[0].timestamp))).toBe(false);
  });

  it('devuelve un historial vacío para un viaje recién creado', async () => {
    const viajeId = `E2E-67-vacio-${Date.now()}`;
    await crearViaje({ id: viajeId, estado: 'asignado' });

    const response = await fetch(
      `${process.env.E2E_API_URL ?? 'http://127.0.0.1:3000'}/api/viajes/${viajeId}/historial-transiciones`,
    );
    const body = await response.json() as { historial: unknown[] };

    expect(response.status).toBe(200);
    expect(body.historial).toEqual([]);
  });
});

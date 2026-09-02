import { crearViaje, post } from './helpers.js';

describe('RF-6.4 - Finalización del viaje en Docker', () => {
  it('registra la finalización y captura el pago mediante el simulador', async () => {
    const viajeId = `E2E-64-${Date.now()}`;
    await crearViaje({ id: viajeId, estado: 'en curso' });

    const { response, body } = await post(`/api/viajes/${viajeId}/finalizacion`, {
      tiempoMinutos: 42,
      distanciaKm: 18.5,
      horaFin: '2026-09-01T10:42:00Z',
      metodoPago: 'tarjeta',
    });

    expect(response.status).toBe(200);
    expect(body.viaje.estado).toBe('completado');
    expect(body.viaje.total).toBe(150 + 18.5 * 80 + 42 * 25);
    expect(body.viaje.tiempoMinutos).toBe(42);
    expect(body.viaje.distanciaKm).toBe(18.5);
    expect(body.paymentId).toBe(`PAY-${viajeId}`);
  });

  it('rechaza finalizar un viaje ya completado', async () => {
    const viajeId = `E2E-64-completado-${Date.now()}`;
    await crearViaje({ id: viajeId, estado: 'completado' });

    const { response, body } = await post(`/api/viajes/${viajeId}/finalizacion`, {
      tiempoMinutos: 30,
      distanciaKm: 12,
      horaFin: '2026-09-01T08:30:00Z',
      metodoPago: 'efectivo',
    });

    expect(response.status).toBe(400);
    expect(body.error).toContain('ya finalizado');
  });
});

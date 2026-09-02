import { crearViaje, post } from './helpers.js';

describe('RF-6.5 - Cancelación por cliente en Docker', () => {
  it('cancela el viaje y obtiene el cargo desde el simulador', async () => {
    const viajeId = `E2E-65-${Date.now()}`;
    await crearViaje({ id: viajeId, estado: 'asignado' });

    const { response, body } = await post(`/api/viajes/${viajeId}/cancelacion-cliente`, {
      motivo: 'Cambio de planes',
    });

    expect(response.status).toBe(200);
    expect(body.viaje.estado).toBe('cancelado');
    expect(body.viaje.motivoCancelacion).toBe('Cambio de planes');
    expect(body.viaje.cargoCancelacion).toBe(200);
    expect(body.viaje.historialTransiciones.at(-1).detalle).toContain('Cancelación por cliente');
  });

  it('rechaza cancelar un viaje ya cancelado', async () => {
    const viajeId = `E2E-65-cancelado-${Date.now()}`;
    await crearViaje({ id: viajeId, estado: 'cancelado' });

    const { response, body } = await post(`/api/viajes/${viajeId}/cancelacion-cliente`, {
      motivo: 'Otro motivo',
    });

    expect(response.status).toBe(400);
    expect(body.error).toContain('ya cancelado');
  });
});

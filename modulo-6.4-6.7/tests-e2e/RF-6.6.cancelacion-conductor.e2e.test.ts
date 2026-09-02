import { crearViaje, post } from './helpers.js';

describe('RF-6.6 - Cancelación por conductor en Docker', () => {
  it('retorna al cliente al despacho y registra el motivo del conductor', async () => {
    const viajeId = `E2E-66-${Date.now()}`;
    await crearViaje({ id: viajeId, estado: 'asignado' });

    const { response, body } = await post(`/api/viajes/${viajeId}/cancelacion-conductor`, {
      motivo: 'Se me averió el vehículo',
    });

    expect(response.status).toBe(200);
    expect(body.viaje.estado).toBe('cancelado');
    expect(body.viaje.motivoCancelacionConductor).toBe('Se me averió el vehículo');
    expect(body.viaje.retornoDespacho).toMatchObject({
      reabrirDespacho: true,
      clienteRetornado: true,
    });
    expect(body.retornoDespacho).toMatchObject({
      reabrirDespacho: true,
      clienteRetornado: true,
    });
    expect(body.viaje.historialTransiciones.at(-1).detalle).toContain('Cancelación por conductor');
  });

  it('rechaza cancelar un viaje ya finalizado', async () => {
    const viajeId = `E2E-66-completado-${Date.now()}`;
    await crearViaje({ id: viajeId, estado: 'completado' });

    const { response, body } = await post(`/api/viajes/${viajeId}/cancelacion-conductor`, {
      motivo: 'No puedo continuar',
    });

    expect(response.status).toBe(400);
    expect(body.error).toContain('ya finalizado');
  });
});

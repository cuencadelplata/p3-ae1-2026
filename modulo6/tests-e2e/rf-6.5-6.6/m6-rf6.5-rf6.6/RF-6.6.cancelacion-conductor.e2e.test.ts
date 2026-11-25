import { afterEach, describe, expect, it } from 'vitest';
import { apiUrl, crearViajeRf6, escucharEvento } from './helpers.js';

describe('RF-6.6 - Cancelación por conductor en e2e', () => {
  const listeners: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(listeners.splice(0).map((listener) => listener.close()));
  });

  it.each(['SOLICITADO', 'ASIGNADO', 'CONDUCTOR_EN_CAMINO', 'ARRIBADO', 'EN_CURSO'] as const)('cancela en %s y publica el evento', async (estado) => {
    const viajeId = await crearViajeRf6(estado);
    const listener = await escucharEvento('despacho.reabrir');
    listeners.push(listener);

    const response = await fetch(`${apiUrl}/api/viajes/${viajeId}/cancelacion-conductor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo: 'Se me averio el vehiculo' }),
    });
    const body = await response.json() as { viaje: { id: string | number; estado: string } };
    const event = await listener.esperar();

    expect(response.status).toBe(200);
    expect(body.viaje).toMatchObject({ id: viajeId, estado: 'CANCELADO' });
    expect(event).toMatchObject({ viajeId, evento: 'cancelacion_conductor', motivo: 'Se me averio el vehiculo' });
  });
});

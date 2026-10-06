import { afterEach, describe, expect, it } from 'vitest';
import { apiUrl, crearViajeRf6, escucharEvento } from './helpers.js';

describe('RF-6.5 - Cancelación por cliente en e2e', () => {
  const listeners: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(listeners.splice(0).map((listener) => listener.close()));
  });

  it('cancela el viaje RF-6 y publica cancelacion_cliente', async () => {
    const viajeId = await crearViajeRf6('SOLICITADO');
    const listener = await escucharEvento('cancelacion_cliente');
    listeners.push(listener);

    const response = await fetch(`${apiUrl}/api/viajes/${viajeId}/cancelacion-cliente`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo: 'Cambio de planes' }),
    });
    const body = await response.json() as { viaje: { id: string | number; estado: string } };
    const event = await listener.esperar();

    expect(response.status).toBe(200);
    expect(body.viaje).toMatchObject({ id: viajeId, estado: 'CANCELADO' });
    expect(event).toMatchObject({ viajeId, evento: 'cancelacion_cliente', motivo: 'Cambio de planes' });
  });
});
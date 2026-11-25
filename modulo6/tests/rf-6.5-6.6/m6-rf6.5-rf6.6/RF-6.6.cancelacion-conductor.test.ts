import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startServices, stopServices } from './helpers.js';

describe('RF-6.6 - Cancelación por conductor', () => {
  const services: { api?: Server } = {};

  afterEach(() => {
    if (services.api) stopServices(services.api);
  });

  it('lista viajes asignados al conductor para que la interfaz obtenga el ID desde la API', async () => {
    const viaje = { id: 'V-LIST-CONDUCTOR', clienteId: 'C-LIST', conductorId: 'D-LIST', estado: 'CONDUCTOR_EN_CAMINO' };
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;

    const response = await fetch(`${running.url}/api/conductores/D-LIST/viajes`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ conductorId: 'D-LIST', viajes: [viaje] });
  });

  it('retorna al cliente al proceso de despacho y registra el motivo del conductor', async () => {
    const viaje = { id: 'V-300', clienteId: 'C-30', conductorId: 'D-30', estado: 'CONDUCTOR_EN_CAMINO' };
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;

    const response = await fetch(`${running.url}/api/viajes/V-300/cancelacion-conductor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo: 'Se me averió el vehículo' }),
    });
    const body = await response.json() as { viaje: typeof viaje };

    expect(response.status).toBe(200);
    expect(body.viaje.estado).toBe('CANCELADO');
    expect(running.events.messages[0]).toMatchObject({
      routingKey: 'despacho.reabrir',
      payload: {
        viajeId: 'V-300',
        clienteId: 'C-30',
        conductorId: 'D-30',
        evento: 'cancelacion_conductor',
      },
    });
  });

  it('incluye el rideRequestId de M5 para que el despacho encuentre su solicitud', async () => {
    const viaje = { id: 'V-310', clienteId: 'C-310', conductorId: 'D-310', estado: 'CONDUCTOR_EN_CAMINO', rideRequestId: 'REQ-M5-9' };
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;

    const response = await fetch(`${running.url}/api/viajes/V-310/cancelacion-conductor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo: 'Imprevisto' }),
    });

    expect(response.status).toBe(200);
    expect(running.events.messages[0]).toMatchObject({
      routingKey: 'despacho.reabrir',
      payload: { viajeId: 'V-310', rideRequestId: 'REQ-M5-9', evento: 'cancelacion_conductor' },
    });
  });

  it('rechaza cancelar un viaje ya finalizado', async () => {
    const viaje = { id: 'V-301', clienteId: 'C-31', conductorId: 'D-31', estado: 'COMPLETADO' };
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;

    const response = await fetch(`${running.url}/api/viajes/V-301/cancelacion-conductor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo: 'No puedo continuar' }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('estado COMPLETADO');
  });
  it.each(['SOLICITADO', 'ASIGNADO', 'CONDUCTOR_EN_CAMINO', 'ARRIBADO', 'EN_CURSO'])(
    'permite cancelar como conductor en %s y publica el evento', async (estado) => {
      const viaje = { id: 'V-ACTIVO', clienteId: 'C', conductorId: 'D', estado };
      const running = await startServices(new Map([[viaje.id, viaje]]));
      services.api = running.api;
      const response = await fetch(`${running.url}/api/viajes/V-ACTIVO/cancelacion-conductor`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ motivo: 'No puedo continuar' }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).viaje.estado).toBe('CANCELADO');
      expect(running.events.messages).toHaveLength(1);
    }
  );

});

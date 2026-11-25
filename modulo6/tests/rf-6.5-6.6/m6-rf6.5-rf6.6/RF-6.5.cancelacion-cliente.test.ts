import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startServices, stopServices } from './helpers.js';

describe('RF-6.5 - Cancelación por cliente', () => {
  const services: { api?: Server } = {};

  afterEach(() => {
    if (services.api) stopServices(services.api);
  });

  it('lista viajes del cliente para que la interfaz obtenga el ID desde la API', async () => {
    const viaje = { id: 'V-LIST-CLIENTE', clienteId: 'C-LIST', estado: 'SOLICITADO' };
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;

    const response = await fetch(`${running.url}/api/clientes/C-LIST/viajes`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ clienteId: 'C-LIST', viajes: [viaje] });
  });

  it('consulta un viaje recibido desde el contexto que abrió la cancelación', async () => {
    const viaje = { id: 'V-CONTEXT', clienteId: 'C-CONTEXT', estado: 'SOLICITADO' };
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;

    const response = await fetch(`${running.url}/api/viajes/V-CONTEXT`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ viaje });
  });

  it('cancela con motivo, estado y cargo consultado externamente', async () => {
    const viaje = { id: 'V-200', clienteId: 'C-10', conductorId: 'D-10', estado: 'SOLICITADO' };
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;

    const response = await fetch(`${running.url}/api/viajes/V-200/cancelacion-cliente`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo: 'Cambio de planes' }),
    });
    const body = await response.json() as { viaje: typeof viaje };

    expect(response.status).toBe(200);
    expect(body.viaje.estado).toBe('CANCELADO');
    expect(running.events.messages[0]).toMatchObject({ routingKey: 'cancelacion_cliente' });
  });

  it('rechaza cancelar un viaje ya cancelado', async () => {
    const viaje = { id: 'V-201', clienteId: 'C-11', conductorId: 'D-11', estado: 'CANCELADO' };
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;

    const response = await fetch(`${running.url}/api/viajes/V-201/cancelacion-cliente`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo: 'Otro motivo' }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('estado CANCELADO');
  });

  it('responde 405 con Allow para un método no permitido y 404 para una ruta inexistente', async () => {
    const running = await startServices(new Map());
    services.api = running.api;

    const methodResponse = await fetch(`${running.url}/api/viajes/V-202/cancelacion-cliente`);
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get('allow')).toBe('POST');

    const routeResponse = await fetch(`${running.url}/api/viajes/V-202/desconocida`, { method: 'POST' });
    expect(routeResponse.status).toBe(404);
  });
  it.each(['SOLICITADO', 'ASIGNADO', 'CONDUCTOR_EN_CAMINO', 'ARRIBADO', 'EN_CURSO'])(
    'permite cancelar como cliente en %s y publica el evento', async (estado) => {
      const viaje = { id: 'V-ACTIVO', clienteId: 'C', conductorId: 'D', estado };
      const running = await startServices(new Map([[viaje.id, viaje]]));
      services.api = running.api;
      const response = await fetch(`${running.url}/api/viajes/V-ACTIVO/cancelacion-cliente`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ motivo: 'No puedo continuar' }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).viaje.estado).toBe('CANCELADO');
      expect(running.events.messages).toHaveLength(1);
    }
  );

});
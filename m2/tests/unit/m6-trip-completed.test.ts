import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tripEventSchema } from '../../src/direcciones/domain';
import { sincronizarViajeCompletado } from '../../src/direcciones/importar-viaje';
import { modulo6Client, Modulo6UnavailableError } from '../../src/clients/modulo6.client';

// Mismo sobre que publica M6 en mobility.events / trip.completed
// (modulo6/src/rf-6.1-6.2-6.3/services/eventos-viaje.service.ts, eventosViajeFinalizado).
function m6Event(overrides: Record<string, unknown> = {}) {
  const tripId = randomUUID();
  return {
    messageId: randomUUID(),
    eventType: 'TripCompleted',
    version: 1,
    occurredAt: '2026-11-17T12:00:00.000Z',
    correlationId: tripId,
    producer: 'm6-viajes',
    data: { tripId, recipientId: 42, total: 1500, paymentId: 'pay_1' },
    ...overrides,
  };
}

// Viaje como lo devuelve GET /api/clientes/{clienteId}/viajes de M6
function m6Trip(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, clienteId: '42', conductorId: '7', estado: 'COMPLETADO',
    origen: 'Av. Siempre Viva 742', destino: 'Terminal de Ómnibus',
    fechaCreacion: '2026-11-17T11:30:00.000Z', historial: [],
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('tripEventSchema', () => {
  it('acepta el trip.completed de M6 y lo normaliza', () => {
    const raw = m6Event();
    const event = tripEventSchema.parse(raw);
    expect(event).toMatchObject({
      source: 'm6', eventId: raw.messageId, type: 'TripCompleted',
      viajeId: raw.data.tripId, clienteId: '42', occurredAt: raw.occurredAt,
    });
  });

  it('sigue aceptando el TripCompleted.v1 propio de M2', () => {
    const event = tripEventSchema.parse({
      eventId: randomUUID(), type: 'TripCompleted.v1', occurredAt: new Date().toISOString(), correlationId: 'c1',
      data: { viajeId: 'v1', clienteId: 'cli1', origen: { direccion: 'Origen 1' }, destino: { direccion: 'Destino 1' } },
    });
    expect(event.source).toBe('m2');
  });

  it('rechaza un trip.completed sin tripId o sin recipientId numérico', () => {
    const raw = m6Event();
    expect(tripEventSchema.safeParse({ ...raw, data: { recipientId: 42 } }).success).toBe(false);
    expect(tripEventSchema.safeParse({ ...raw, data: { tripId: 'x', recipientId: '42' } }).success).toBe(false);
  });
});

describe('sincronizarViajeCompletado', () => {
  const normalized = () => tripEventSchema.parse(m6Event()) as Extract<ReturnType<typeof tripEventSchema.parse>, { source: 'm6' }>;

  it('pide el viaje a M6 y registra origen y destino como finalización', async () => {
    const event = normalized();
    const spy = vi.spyOn(modulo6Client, 'obtenerViajeDeCliente').mockResolvedValue(m6Trip(event.viajeId) as any);
    const service = { recordJourney: vi.fn().mockResolvedValue(undefined) };

    await sincronizarViajeCompletado(event, service as any);

    expect(spy).toHaveBeenCalledWith('42', event.viajeId);
    expect(service.recordJourney).toHaveBeenCalledWith({
      viajeId: event.viajeId, clienteId: '42',
      origen: { direccion: 'Av. Siempre Viva 742', latitud: null, longitud: null },
      destino: { direccion: 'Terminal de Ómnibus', latitud: null, longitud: null },
      fechaViaje: new Date(event.occurredAt), fechaReferencia: 'FINALIZACION', eventId: event.eventId,
    });
  });

  it('falla (para que el worker reintente) si M6 no está disponible', async () => {
    const event = normalized();
    vi.spyOn(modulo6Client, 'obtenerViajeDeCliente').mockRejectedValue(new Modulo6UnavailableError());
    const service = { recordJourney: vi.fn() };
    await expect(sincronizarViajeCompletado(event, service as any)).rejects.toBeInstanceOf(Modulo6UnavailableError);
    expect(service.recordJourney).not.toHaveBeenCalled();
  });

  it('no registra si M6 devuelve el viaje sin direcciones o sin completar', async () => {
    const event = normalized();
    const service = { recordJourney: vi.fn() };
    vi.spyOn(modulo6Client, 'obtenerViajeDeCliente').mockResolvedValueOnce(m6Trip(event.viajeId, { origen: undefined }) as any);
    await expect(sincronizarViajeCompletado(event, service as any)).rejects.toMatchObject({ code: 'M6_ADDRESSES_REQUIRED' });
    vi.spyOn(modulo6Client, 'obtenerViajeDeCliente').mockResolvedValueOnce(m6Trip(event.viajeId, { estado: 'EN_CURSO' }) as any);
    await expect(sincronizarViajeCompletado(event, service as any)).rejects.toMatchObject({ code: 'TRIP_NOT_COMPLETED' });
    expect(service.recordJourney).not.toHaveBeenCalled();
  });

  it('rechaza un viaje de otro cliente', async () => {
    const event = normalized();
    vi.spyOn(modulo6Client, 'obtenerViajeDeCliente').mockResolvedValue(m6Trip(event.viajeId, { clienteId: '99' }) as any);
    const service = { recordJourney: vi.fn() };
    await expect(sincronizarViajeCompletado(event, service as any)).rejects.toMatchObject({ code: 'M6_INVALID_CONTRACT' });
    expect(service.recordJourney).not.toHaveBeenCalled();
  });
});

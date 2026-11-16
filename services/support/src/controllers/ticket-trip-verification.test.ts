import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { createSupportApp } from '../app.js';
import { databaseUnavailable, tripServiceUnavailable } from '../errors/support-error.js';
import type { SupportEventPublisher } from '../events/support-event-publisher.js';
import type { TripVerifier } from '../integrations/m6-trips.js';
import { InMemoryTicketRepository } from '../models/ticket.model.js';
import { TicketService } from '../services/ticket.service.js';

const contract = YAML.parse(fs.readFileSync(path.resolve(process.cwd(), '../../openapi/rf85-support.yaml'), 'utf8'));

const PEDIDO = { tripId: 'trip-1', motivo: 'Demora' };

let app: Express;
let repository: InMemoryTicketRepository;
let publish: ReturnType<typeof vi.fn<SupportEventPublisher['publish']>>;
let existe: ReturnType<typeof vi.fn<TripVerifier['existe']>>;

beforeEach(() => {
  repository = new InMemoryTicketRepository();
  publish = vi.fn<SupportEventPublisher['publish']>(async () => undefined);
  existe = vi.fn<TripVerifier['existe']>(async () => true);
  const tripVerifier: TripVerifier = { existe, isReachable: async () => true };
  app = createSupportApp({ ticketService: new TicketService(repository, { publish }, tripVerifier), legacyEvents: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function crear(body: object, clave?: string) {
  const req = request(app).post('/tickets');
  return (clave === undefined ? req : req.set('Idempotency-Key', clave)).send(body);
}

function m6Caido() {
  existe.mockImplementation(async () => {
    throw tripServiceUnavailable(new Error('connect ECONNREFUSED 10.0.0.6:3000'));
  });
}

async function cantidadDeTickets() {
  return (await request(app).get('/tickets')).body.length;
}

describe('POST /tickets: el viaje existe en M6', () => {
  it('crea el ticket (201) después de consultar a M6 por ese tripId', async () => {
    const res = await crear(PEDIDO);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tripId: 'trip-1', estado: 'ABIERTO', version: 1 });
    expect(existe).toHaveBeenCalledTimes(1);
    expect(existe).toHaveBeenCalledWith('trip-1');
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('verifica el viaje recibido con el alias viajeId', async () => {
    const res = await crear({ viajeId: 'trip-9', motivo: 'Demora' });

    expect(res.status).toBe(201);
    expect(existe).toHaveBeenCalledWith('trip-9');
  });

  it('con Idempotency-Key nueva también verifica antes de crear', async () => {
    const res = await crear(PEDIDO, 'clave-1');

    expect(res.status).toBe(201);
    expect(existe).toHaveBeenCalledTimes(1);
  });

  it('un pedido inválido se rechaza con 400 sin consultar a M6', async () => {
    const res = await crear({ tripId: 123, motivo: '' });

    expect(res.status).toBe(400);
    expect(existe).not.toHaveBeenCalled();
  });
});

describe('POST /tickets: M6 no conoce el viaje', () => {
  beforeEach(() => {
    existe.mockResolvedValue(false);
  });

  it('responde 422 SUPPORT_TRIP_NOT_FOUND con el formato de error', async () => {
    const res = await crear(PEDIDO);

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: {
        code: 'SUPPORT_TRIP_NOT_FOUND',
        message: 'El viaje indicado no existe.',
        details: [{ field: 'tripId', reason: 'M6 no tiene un viaje con ese identificador.' }],
      },
      correlationId: res.headers['x-correlation-id'],
    });
    expect(res.headers['retry-after']).toBeUndefined();
  });

  it('no crea el ticket ni publica ticket.creado', async () => {
    await crear(PEDIDO);
    await crear(PEDIDO, 'clave-1');

    expect(await cantidadDeTickets()).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it('no reserva la Idempotency-Key: el mismo pedido crea el ticket cuando el viaje existe', async () => {
    const rechazado = await crear(PEDIDO, 'clave-1');
    existe.mockResolvedValue(true);
    const aceptado = await crear(PEDIDO, 'clave-1');

    expect(rechazado.status).toBe(422);
    expect(aceptado.status).toBe(201);
    expect(await cantidadDeTickets()).toBe(1);
  });

  it('coincide con el ejemplo del contrato', async () => {
    const res = await crear(PEDIDO);
    const ejemplo = contract.components.responses.ViajeNoEncontrado.content['application/json'].examples.viajeInexistente.value;

    expect(contract.paths['/tickets'].post.responses['422'].$ref).toBe('#/components/responses/ViajeNoEncontrado');
    expect(res.body.error).toEqual(ejemplo.error);
  });
});

describe('POST /tickets: M6 caído o sin respuesta (falla cerrado)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m6Caido();
  });

  it('responde 503 SUPPORT_TRIP_SERVICE_UNAVAILABLE con Retry-After', async () => {
    const res = await crear(PEDIDO);

    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.body).toEqual({
      error: {
        code: 'SUPPORT_TRIP_SERVICE_UNAVAILABLE',
        message: 'No fue posible verificar el viaje en este momento. Reintentá en unos instantes.',
      },
      correlationId: res.headers['x-correlation-id'],
    });
  });

  it('no expone el detalle de la falla de M6', async () => {
    const res = await crear(PEDIDO);

    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.6/);
  });

  it('no crea el ticket ni publica ticket.creado, con y sin Idempotency-Key', async () => {
    const sinClave = await crear(PEDIDO);
    const conClave = await crear(PEDIDO, 'clave-1');

    expect(sinClave.status).toBe(503);
    expect(conClave.status).toBe(503);
    expect(await cantidadDeTickets()).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it('el mismo pedido con la misma clave crea el ticket cuando M6 se recupera', async () => {
    const durante = await crear(PEDIDO, 'clave-1');
    existe.mockImplementation(async () => true);
    const despues = await crear(PEDIDO, 'clave-1');

    expect(durante.status).toBe(503);
    expect(despues.status).toBe(201);
    expect(await cantidadDeTickets()).toBe(1);
  });

  it('coincide con el ejemplo del contrato, que declara Retry-After', async () => {
    const res = await crear(PEDIDO);
    const respuesta = contract.components.responses.DependenciaNoDisponible;

    expect(contract.paths['/tickets'].post.responses['503'].$ref).toBe('#/components/responses/DependenciaNoDisponible');
    expect(respuesta.headers['Retry-After']).toBeDefined();
    expect(res.body.error).toEqual(respuesta.content['application/json'].examples.viajesNoDisponible.value.error);
  });

  it('consultar, listar y cambiar de estado no dependen de M6', async () => {
    existe.mockImplementation(async () => true);
    const { body: ticket } = await crear(PEDIDO);
    m6Caido();
    existe.mockClear();

    expect((await request(app).get(`/tickets/${ticket.id}`)).status).toBe(200);
    expect((await request(app).get('/tickets')).status).toBe(200);
    expect((await request(app).get(`/tickets/${ticket.id}/historial`)).status).toBe(200);
    expect((await request(app).patch(`/tickets/${ticket.id}/estado`).send({ estado: 'EN_PROCESO' })).status).toBe(200);
    expect(existe).not.toHaveBeenCalled();
  });
});

describe('POST /tickets: reintentos idempotentes sin consultar a M6', () => {
  it('M6 caído + reintento con una clave ya usada: 200 con el ticket existente', async () => {
    const primera = await crear(PEDIDO, 'clave-1');
    m6Caido();
    existe.mockClear();

    const reintento = await crear(PEDIDO, 'clave-1');

    expect(primera.status).toBe(201);
    expect(reintento.status).toBe(200);
    expect(reintento.body).toEqual(primera.body);
    expect(existe).not.toHaveBeenCalled();
    expect(await cantidadDeTickets()).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('con M6 disponible, el reintento tampoco lo consulta', async () => {
    await crear(PEDIDO, 'clave-1');
    existe.mockClear();

    const reintento = await crear({ viajeId: 'trip-1', motivo: 'Demora' }, 'clave-1');

    expect(reintento.status).toBe(200);
    expect(existe).not.toHaveBeenCalled();
  });

  it('el reintento devuelve el ticket en su estado actual', async () => {
    const primera = await crear(PEDIDO, 'clave-1');
    await request(app).patch(`/tickets/${primera.body.id}/estado`).send({ estado: 'EN_PROCESO' });
    m6Caido();

    const reintento = await crear(PEDIDO, 'clave-1');

    expect(reintento.status).toBe(200);
    expect(reintento.body).toMatchObject({ id: primera.body.id, estado: 'EN_PROCESO', version: 2 });
  });

  it('M6 caído + clave ya usada con otro pedido: 409, sin consultar a M6', async () => {
    await crear(PEDIDO, 'clave-1');
    m6Caido();
    existe.mockClear();

    const res = await crear({ tripId: 'trip-2', motivo: 'Demora' }, 'clave-1');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUPPORT_IDEMPOTENCY_CONFLICT');
    expect(existe).not.toHaveBeenCalled();
  });

  it('pedidos simultáneos con la misma clave crean un solo ticket', async () => {
    const respuestas = await Promise.all(Array.from({ length: 6 }, () => crear(PEDIDO, 'clave-1')));

    expect(respuestas.filter((res) => res.status === 201)).toHaveLength(1);
    expect(respuestas.filter((res) => res.status === 200)).toHaveLength(5);
    expect(new Set(respuestas.map((res) => res.body.id)).size).toBe(1);
    expect(await cantidadDeTickets()).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('si la base no responde al buscar la clave: 503 SUPPORT_DB_UNAVAILABLE, sin consultar a M6', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(repository, 'buscarPorClave').mockRejectedValue(databaseUnavailable(new Error('connect ECONNREFUSED')));

    const res = await crear(PEDIDO, 'clave-1');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SUPPORT_DB_UNAVAILABLE');
    expect(res.headers['retry-after']).toBeUndefined();
    expect(existe).not.toHaveBeenCalled();
  });
});

describe('POST /tickets sin verificador (M6_TRIPS_URL sin definir)', () => {
  beforeEach(() => {
    app = createSupportApp({ ticketService: new TicketService(repository, { publish }), legacyEvents: false });
  });

  it('acepta cualquier tripId, como antes', async () => {
    const res = await crear({ tripId: 'un-viaje-que-nadie-verifico', motivo: 'Demora' });

    expect(res.status).toBe(201);
  });

  it('con Idempotency-Key no hace la búsqueda previa de la clave', async () => {
    const buscarPorClave = vi.spyOn(repository, 'buscarPorClave');

    const primera = await crear(PEDIDO, 'clave-1');
    const segunda = await crear(PEDIDO, 'clave-1');

    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(200);
    expect(buscarPorClave).not.toHaveBeenCalled();
  });
});

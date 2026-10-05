import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupportApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrations.js';
import { NoopSupportEventPublisher } from '../../src/events/support-event-publisher.js';
import { PostgresTicketRepository } from '../../src/repositories/postgres-ticket.repository.js';
import { TicketService } from '../../src/services/ticket.service.js';
import { createEphemeralSchema, type EphemeralSchema } from './helpers/ephemeral-schema.js';

const SIMULTANEOS = 10;

let db: EphemeralSchema;
let repository: PostgresTicketRepository;
let app: Express;

// Una instancia de Support: su propio pool, su repositorio y su app.
function nuevaInstancia() {
  const repositorio = new PostgresTicketRepository(db.newPool(), db.schema);
  const ticketService = new TicketService(repositorio, new NoopSupportEventPublisher());
  return { repositorio, app: createSupportApp({ ticketService, legacyEvents: false }) };
}

beforeAll(async () => {
  db = await createEphemeralSchema();
  await runMigrations(db.pool, db.schema);
  ({ repositorio: repository, app } = nuevaInstancia());
});

afterAll(async () => {
  await db.drop();
});

beforeEach(async () => {
  await db.pool.query(`TRUNCATE ${db.schema}.idempotency_keys, ${db.schema}.ticket_history, ${db.schema}.tickets`);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function contar(tabla: string): Promise<number> {
  const { rows } = await db.pool.query(`SELECT count(*)::int AS total FROM ${db.schema}.${tabla}`);
  return rows[0].total;
}

function simultaneos<T>(pedido: (indice: number) => PromiseLike<T>): Promise<T[]> {
  return Promise.all(Array.from({ length: SIMULTANEOS }, (_, indice) => pedido(indice)));
}

describe('cambios de estado simultáneos sobre PostgreSQL', () => {
  it('10 PATCH con la misma expectedVersion: exactamente 1 éxito y el resto 409', async () => {
    const ticket = await repository.crear('trip-1', 'Demora');

    const respuestas = await simultaneos((indice) =>
      request(app)
        .patch(`/tickets/${ticket.id}/estado`)
        .send({ estado: indice % 2 === 0 ? 'EN_PROCESO' : 'RESUELTO', expectedVersion: 1 }),
    );

    const estados = respuestas.map((res) => res.status);
    expect(estados.filter((status) => status === 200)).toHaveLength(1);
    expect(estados.filter((status) => status === 409)).toHaveLength(SIMULTANEOS - 1);
    for (const res of respuestas.filter((r) => r.status === 409)) {
      expect(res.body.error.code).toBe('SUPPORT_CONCURRENCY_CONFLICT');
    }

    const aceptada = respuestas.find((res) => res.status === 200)!;
    expect(await repository.obtenerPorId(ticket.id)).toMatchObject({ estado: aceptada.body.estado, version: 2 });
    const historial = await repository.listarHistorial(ticket.id);
    expect(historial).toHaveLength(2);
    expect(historial[1]).toMatchObject({ estadoAnterior: 'ABIERTO', estadoNuevo: aceptada.body.estado });
  });

  it('10 PATCH sin expectedVersion hacia el mismo estado: una sola transición registrada', async () => {
    const ticket = await repository.crear('trip-1', 'Demora');

    const respuestas = await simultaneos(() =>
      request(app).patch(`/tickets/${ticket.id}/estado`).send({ estado: 'EN_PROCESO' }),
    );

    // Cada pedido aplica el cambio, lo encuentra hecho (200 sin efecto) o
    // pierde la carrera (409). Nunca se registra dos veces.
    const estados = respuestas.map((res) => res.status);
    expect(estados.every((status) => status === 200 || status === 409)).toBe(true);
    expect(estados).toContain(200);
    for (const res of respuestas.filter((r) => r.status === 409)) {
      expect(res.body.error.code).toBe('SUPPORT_CONCURRENCY_CONFLICT');
    }

    expect(await repository.obtenerPorId(ticket.id)).toMatchObject({ estado: 'EN_PROCESO', version: 2 });
    const historial = await repository.listarHistorial(ticket.id);
    expect(historial.map((e) => [e.estadoAnterior, e.estadoNuevo])).toEqual([
      [null, 'ABIERTO'],
      ['ABIERTO', 'EN_PROCESO'],
    ]);
  });

  it('dos instancias con pools distintos no aplican el mismo cambio dos veces', async () => {
    const ticket = await repository.crear('trip-1', 'Demora');
    const otra = nuevaInstancia();

    const respuestas = await simultaneos((indice) =>
      request(indice % 2 === 0 ? app : otra.app)
        .patch(`/tickets/${ticket.id}/estado`)
        .send({ estado: 'RESUELTO', expectedVersion: 1 }),
    );

    expect(respuestas.filter((res) => res.status === 200)).toHaveLength(1);
    expect(respuestas.filter((res) => res.status === 409)).toHaveLength(SIMULTANEOS - 1);
    expect(await repository.listarHistorial(ticket.id)).toHaveLength(2);
  });
});

describe('creación idempotente simultánea sobre PostgreSQL', () => {
  it('10 POST con la misma Idempotency-Key desde dos instancias: 1 solo ticket', async () => {
    const otra = nuevaInstancia();

    const respuestas = await simultaneos((indice) =>
      request(indice % 2 === 0 ? app : otra.app)
        .post('/tickets')
        .set('Idempotency-Key', 'clave-compartida')
        .send(indice % 3 === 0 ? { viajeId: 'trip-1', motivo: 'Demora' } : { tripId: 'trip-1', motivo: 'Demora' }),
    );

    const estados = respuestas.map((res) => res.status);
    expect(estados.filter((status) => status === 201)).toHaveLength(1);
    expect(estados.filter((status) => status === 200)).toHaveLength(SIMULTANEOS - 1);
    expect(new Set(respuestas.map((res) => res.body.id)).size).toBe(1);

    expect(await contar('tickets')).toBe(1);
    expect(await contar('idempotency_keys')).toBe(1);
    expect(await contar('ticket_history')).toBe(1);
    const historial = await repository.listarHistorial(respuestas[0].body.id);
    expect(historial).toMatchObject([{ estadoAnterior: null, estadoNuevo: 'ABIERTO' }]);
  });

  it('con la misma clave y pedidos distintos sólo uno crea el ticket; el resto es 409', async () => {
    const otra = nuevaInstancia();

    const respuestas = await simultaneos((indice) =>
      request(indice % 2 === 0 ? app : otra.app)
        .post('/tickets')
        .set('Idempotency-Key', 'clave-disputada')
        .send({ tripId: `trip-${indice}`, motivo: 'Demora' }),
    );

    const estados = respuestas.map((res) => res.status);
    expect(estados.filter((status) => status === 201)).toHaveLength(1);
    expect(estados.filter((status) => status === 409)).toHaveLength(SIMULTANEOS - 1);
    expect(await contar('tickets')).toBe(1);
    expect(await contar('ticket_history')).toBe(1);
  });

  it('10 POST sin clave crean 10 tickets, cada uno con su historial inicial', async () => {
    const respuestas = await simultaneos(() => request(app).post('/tickets').send({ tripId: 'trip-1', motivo: 'Demora' }));

    expect(respuestas.every((res) => res.status === 201)).toBe(true);
    expect(new Set(respuestas.map((res) => res.body.id)).size).toBe(SIMULTANEOS);
    expect(await contar('tickets')).toBe(SIMULTANEOS);
    expect(await contar('ticket_history')).toBe(SIMULTANEOS);
  });
});

describe('rollback transaccional', () => {
  // Fuerza que todo INSERT en el historial falle, sin tocar el código.
  async function romperHistorial() {
    await db.pool.query(
      `ALTER TABLE ${db.schema}.ticket_history ADD CONSTRAINT historial_roto CHECK (false) NOT VALID`,
    );
  }

  afterEach(async () => {
    await db.pool.query(`ALTER TABLE ${db.schema}.ticket_history DROP CONSTRAINT IF EXISTS historial_roto`);
  });

  it('si falla el historial inicial, el ticket no se crea', async () => {
    await romperHistorial();

    await expect(repository.crear('trip-1', 'Demora')).rejects.toMatchObject({ code: '23514' });

    expect(await contar('tickets')).toBe(0);
    expect(await contar('ticket_history')).toBe(0);
  });

  it('si falla el historial inicial, tampoco queda la clave de idempotencia', async () => {
    await romperHistorial();

    await expect(
      repository.crearConClave('trip-1', 'Demora', { clave: 'clave-1', hash: 'huella-1' }),
    ).rejects.toMatchObject({ code: '23514' });

    expect(await contar('tickets')).toBe(0);
    expect(await contar('idempotency_keys')).toBe(0);
  });

  it('si falla el historial del cambio, el ticket no cambia de estado ni de versión', async () => {
    const ticket = await repository.crear('trip-1', 'Demora');
    await romperHistorial();

    await expect(repository.actualizarEstado(ticket.id, 'RESUELTO', { expectedVersion: 1 })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(repository.actualizarEstado(ticket.id, 'RESUELTO')).rejects.toMatchObject({ code: '23514' });

    expect(await repository.obtenerPorId(ticket.id)).toEqual(ticket);
    expect(await repository.listarHistorial(ticket.id)).toHaveLength(1);
  });

  it('por la API ese fallo es un 500 genérico y el ticket queda intacto', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ticket = await repository.crear('trip-1', 'Demora');
    await romperHistorial();

    const res = await request(app).patch(`/tickets/${ticket.id}/estado`).send({ estado: 'EN_PROCESO' });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('SUPPORT_INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('historial_roto');
    expect(await repository.obtenerPorId(ticket.id)).toEqual(ticket);
  });

  it('después del fallo el repositorio sigue operando con normalidad', async () => {
    await romperHistorial();
    await repository.crear('trip-1', 'Demora').catch(() => undefined);
    await db.pool.query(`ALTER TABLE ${db.schema}.ticket_history DROP CONSTRAINT historial_roto`);

    const ticket = await repository.crear('trip-1', 'Demora');

    expect(await contar('tickets')).toBe(1);
    expect(await repository.listarHistorial(ticket.id)).toHaveLength(1);
  });
});

describe('paginación sobre PostgreSQL', () => {
  it('recorre 60 tickets de igual fecha de creación sin repetir ni saltear', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T10:00:00.000Z'));
    const ids: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      ids.push((await repository.crear(i % 2 === 0 ? 'trip-par' : 'trip-impar', 'Demora')).id);
    }
    vi.useRealTimers();

    const recorridos: string[] = [];
    const paginas: number[] = [];
    let cursor: string | undefined;
    do {
      const res = await request(app).get('/tickets').query(cursor ? { limit: '7', cursor } : { limit: '7' });
      expect(res.status).toBe(200);
      recorridos.push(...res.body.map((t: { id: string }) => t.id));
      paginas.push(res.body.length);
      cursor = res.headers['x-next-cursor'];
    } while (cursor);

    expect(paginas).toEqual([7, 7, 7, 7, 7, 7, 7, 7, 4]);
    expect(new Set(recorridos).size).toBe(60);
    expect(recorridos).toEqual([...ids].sort().reverse());
  });

  it('el recorrido paginado con filtro devuelve sólo los tickets del viaje', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T10:00:00.000Z'));
    const pares: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const ticket = await repository.crear(i % 2 === 0 ? 'trip-par' : 'trip-impar', 'Demora');
      if (i % 2 === 0) pares.push(ticket.id);
    }
    vi.useRealTimers();

    const recorridos: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await request(app)
        .get('/tickets')
        .query(cursor ? { tripId: 'trip-par', limit: '3', cursor } : { tripId: 'trip-par', limit: '3' });
      recorridos.push(...res.body.map((t: { id: string }) => t.id));
      cursor = res.headers['x-next-cursor'];
    } while (cursor);

    expect(recorridos).toEqual([...pares].sort().reverse());
  });

  it('un ticket creado entre dos páginas no altera las siguientes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      vi.setSystemTime(new Date(Date.parse('2026-10-01T10:00:00.000Z') + i * 1000));
      ids.push((await repository.crear('trip-1', 'Demora')).id);
    }
    vi.useRealTimers();

    const primera = await request(app).get('/tickets').query({ limit: '2' });
    await repository.crear('trip-nuevo', 'Demora');
    const segunda = await request(app).get('/tickets').query({ limit: '2', cursor: primera.headers['x-next-cursor'] });

    expect(primera.body.map((t: { id: string }) => t.id)).toEqual([ids[3], ids[2]]);
    expect(segunda.body.map((t: { id: string }) => t.id)).toEqual([ids[1], ids[0]]);
  });
});

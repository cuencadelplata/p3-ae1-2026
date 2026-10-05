import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSupportApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrations.js';
import { createSupportPool } from '../../src/db/pool.js';
import { NoopSupportEventPublisher } from '../../src/events/support-event-publisher.js';
import { PostgresTicketRepository } from '../../src/repositories/postgres-ticket.repository.js';
import { TicketService } from '../../src/services/ticket.service.js';
import { ticketRepositoryContract } from '../shared/ticket-repository.contract.js';
import { createEphemeralSchema, type EphemeralSchema } from './helpers/ephemeral-schema.js';

let db: EphemeralSchema;

beforeAll(async () => {
  db = await createEphemeralSchema();
  await runMigrations(db.pool, db.schema);
});

afterAll(async () => {
  await db.drop();
});

async function vaciar() {
  await db.pool.query(`TRUNCATE ${db.schema}.idempotency_keys, ${db.schema}.ticket_history, ${db.schema}.tickets`);
}

// Mismos casos que InMemoryTicketRepository, contra PostgreSQL real. Cada caso
// parte de tablas vacías.
ticketRepositoryContract('PostgresTicketRepository', async () => {
  await vaciar();
  return new PostgresTicketRepository(db.pool, db.schema);
});

describe('PostgresTicketRepository: persistencia', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('los datos sobreviven a un repositorio y un pool nuevos', async () => {
    await vaciar();
    const repository = new PostgresTicketRepository(db.pool, db.schema);
    const ticket = await repository.crear('trip-persistente', 'Demora', { actor: 'pasajero-1' });
    await repository.actualizarEstado(ticket.id, 'EN_PROCESO', { actor: 'agente-1' });

    const otro = new PostgresTicketRepository(db.newPool(), db.schema);

    expect(await otro.obtenerPorId(ticket.id)).toMatchObject({ tripId: 'trip-persistente', estado: 'EN_PROCESO', version: 2 });
    expect(await otro.listarHistorial(ticket.id)).toHaveLength(2);
  });

  it('guarda correlation_id igual al trip_id', async () => {
    await vaciar();
    const ticket = await new PostgresTicketRepository(db.pool, db.schema).crear('trip-corr', 'Demora');

    const { rows } = await db.pool.query(`SELECT trip_id, correlation_id FROM ${db.schema}.tickets WHERE id = $1`, [ticket.id]);

    expect(rows[0]).toEqual({ trip_id: 'trip-corr', correlation_id: 'trip-corr' });
  });

  it('rechaza un nombre de schema que no es un identificador simple', () => {
    expect(() => new PostgresTicketRepository(db.pool, 'support; DROP SCHEMA receipts')).toThrow(/identificador simple/);
  });
});

describe('PostgresTicketRepository: base no disponible', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('una base inalcanzable se informa como SUPPORT_DB_UNAVAILABLE, rápido', async () => {
    const pool = createSupportPool('postgres://m8_support:x@127.0.0.1:1/m8');
    const repository = new PostgresTicketRepository(pool, 'support');

    const inicio = Date.now();
    for (const operacion of [
      () => repository.crear('trip-1', 'Demora'),
      () => repository.crearConClave('trip-1', 'Demora', { clave: 'c', hash: 'h' }),
      () => repository.obtenerPorId('00000000-0000-4000-8000-000000000000'),
      () => repository.actualizarEstado('00000000-0000-4000-8000-000000000000', 'RESUELTO'),
      () => repository.listarHistorial('00000000-0000-4000-8000-000000000000'),
      () => repository.listar({ limit: 10 }),
    ]) {
      await expect(operacion()).rejects.toMatchObject({ code: 'SUPPORT_DB_UNAVAILABLE', status: 503 });
    }
    expect(Date.now() - inicio).toBeLessThan(20000);
    await pool.end();
  });

  it('con las migraciones pendientes responde SUPPORT_DB_UNAVAILABLE, no un error interno', async () => {
    const sinTablas = await createEphemeralSchema();
    try {
      const repository = new PostgresTicketRepository(sinTablas.pool, sinTablas.schema);

      await expect(repository.crear('trip-1', 'Demora')).rejects.toMatchObject({ code: 'SUPPORT_DB_UNAVAILABLE' });
      await expect(repository.listar({ limit: 10 })).rejects.toMatchObject({ code: 'SUPPORT_DB_UNAVAILABLE' });
    } finally {
      await sinTablas.drop();
    }
  });

  it('la API responde 503 con el formato de error y registra la causa', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pool = createSupportPool('postgres://m8_support:x@127.0.0.1:1/m8');
    const ticketService = new TicketService(new PostgresTicketRepository(pool, 'support'), new NoopSupportEventPublisher());
    const app = createSupportApp({ ticketService, legacyEvents: false });

    const res = await request(app)
      .post('/tickets')
      .set('X-Correlation-Id', 'corr-503')
      .send({ tripId: 'trip-1', motivo: 'Demora' });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: {
        code: 'SUPPORT_DB_UNAVAILABLE',
        message: 'El servicio de soporte no está disponible en este momento. Reintentá en unos instantes.',
      },
      correlationId: 'corr-503',
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0][1]).toMatchObject({ correlationId: 'corr-503' });
    await pool.end();
  });
});

describe('API de tickets sobre PostgreSQL', () => {
  it('crea, consulta, cambia de estado, lista y devuelve el historial', async () => {
    await vaciar();
    const ticketService = new TicketService(new PostgresTicketRepository(db.pool, db.schema), new NoopSupportEventPublisher());
    const app = createSupportApp({ ticketService, legacyEvents: false });

    const creado = await request(app)
      .post('/tickets')
      .set('Idempotency-Key', 'api-pg-1')
      .set('X-Actor-Id', 'pasajero-1')
      .send({ viajeId: 'trip-api', motivo: 'Demora' });
    expect(creado.status).toBe(201);

    const reintento = await request(app)
      .post('/tickets')
      .set('Idempotency-Key', 'api-pg-1')
      .send({ tripId: 'trip-api', motivo: 'Demora' });
    expect(reintento.status).toBe(200);
    expect(reintento.body.id).toBe(creado.body.id);

    const cambiado = await request(app)
      .patch(`/tickets/${creado.body.id}/estado`)
      .send({ estado: 'RESUELTO', expectedVersion: 1 });
    expect(cambiado.body).toMatchObject({ estado: 'RESUELTO', version: 2 });

    const prohibido = await request(app).patch(`/tickets/${creado.body.id}/estado`).send({ estado: 'EN_PROCESO' });
    expect(prohibido.body.error.code).toBe('SUPPORT_INVALID_TRANSITION');

    const listado = await request(app).get('/tickets').query({ tripId: 'trip-api', estado: 'RESUELTO' });
    expect(listado.body.map((t: { id: string }) => t.id)).toEqual([creado.body.id]);

    const historial = await request(app).get(`/tickets/${creado.body.id}/historial`);
    expect(historial.body).toMatchObject([
      { estadoAnterior: null, estadoNuevo: 'ABIERTO', cambiadoPor: 'pasajero-1' },
      { estadoAnterior: 'ABIERTO', estadoNuevo: 'RESUELTO' },
    ]);
    expect(typeof historial.body[0].id).toBe('number');

    const inexistente = await request(app).get('/tickets/no-existe');
    expect(inexistente.status).toBe(404);
  });
});

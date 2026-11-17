import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createSupportApp } from '../app.js';
import { NoopSupportEventPublisher } from '../events/support-event-publisher.js';
import { InMemoryTicketRepository } from '../models/ticket.model.js';
import { TicketService } from '../services/ticket.service.js';
import { checkSupportReadiness, type SupportReadiness } from './readiness.js';

function database(available: boolean, migrationsApplied: boolean) {
  return { isAvailable: async () => available, migrationsApplied };
}

function appCon(readiness?: () => Promise<SupportReadiness>) {
  const ticketService = new TicketService(new InMemoryTicketRepository(), new NoopSupportEventPublisher());
  return createSupportApp({ ticketService, legacyEvents: false, readiness });
}

describe('checkSupportReadiness', () => {
  it('ok: base disponible, migraciones aplicadas y broker conectado', async () => {
    const readiness = await checkSupportReadiness({ database: database(true, true), legacyBroker: () => true });

    expect(readiness).toEqual({
      status: 'ok',
      checks: {
        postgres: { status: 'available', critical: true },
        migrations: { status: 'applied', critical: true },
        rabbitmq: { status: 'available', critical: false },
      },
    });
  });

  it('degraded: base bien pero broker heredado caído', async () => {
    const readiness = await checkSupportReadiness({ database: database(true, true), legacyBroker: () => false });

    expect(readiness.status).toBe('degraded');
    expect(readiness.checks.rabbitmq).toEqual({ status: 'unavailable', critical: false });
    expect(readiness.checks.postgres?.status).toBe('available');
  });

  it('unavailable: base caída', async () => {
    const readiness = await checkSupportReadiness({ database: database(false, true), legacyBroker: () => true });

    expect(readiness.status).toBe('unavailable');
    expect(readiness.checks.postgres).toEqual({ status: 'unavailable', critical: true });
  });

  it('unavailable: migraciones pendientes aunque la base responda', async () => {
    const readiness = await checkSupportReadiness({ database: database(true, false), legacyBroker: () => true });

    expect(readiness.status).toBe('unavailable');
    expect(readiness.checks.migrations).toEqual({ status: 'pending', critical: true });
  });

  it('la base caída pesa más que el broker caído: unavailable, no degraded', async () => {
    const readiness = await checkSupportReadiness({ database: database(false, false), legacyBroker: () => false });

    expect(readiness.status).toBe('unavailable');
  });

  it('sin broker heredado (SUPPORT_LEGACY_EVENTS=off) RabbitMQ no se informa ni degrada', async () => {
    const readiness = await checkSupportReadiness({ database: database(true, true) });

    expect(readiness.status).toBe('ok');
    expect(readiness.checks.rabbitmq).toBeUndefined();
  });
});

describe('GET /health/live', () => {
  it('responde 200 mientras el proceso vive, aun con la base caída', async () => {
    const app = appCon(() => checkSupportReadiness({ database: database(false, false) }));

    const res = await request(app).get('/health/live');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'm8-soporte' });
  });
});

describe('GET /health/ready', () => {
  it('200 ok con el detalle de checks', async () => {
    const app = appCon(() => checkSupportReadiness({ database: database(true, true), legacyBroker: () => true }));

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: {
        postgres: { status: 'available', critical: true },
        migrations: { status: 'applied', critical: true },
        rabbitmq: { status: 'available', critical: false },
      },
      service: 'm8-soporte',
    });
  });

  it('200 degraded con el broker caído', async () => {
    const app = appCon(() => checkSupportReadiness({ database: database(true, true), legacyBroker: () => false }));

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
  });

  it.each([
    ['la base caída', database(false, true)],
    ['migraciones pendientes', database(true, false)],
  ])('503 unavailable con %s', async (_caso, db) => {
    const app = appCon(() => checkSupportReadiness({ database: db }));

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.checks.postgres).toBeDefined();
    expect(res.body.checks.migrations).toBeDefined();
  });

  it('usa sólo los estados del contrato común: ok, degraded o unavailable', async () => {
    for (const probes of [
      { database: database(true, true) },
      { database: database(true, true), legacyBroker: () => false },
      { database: database(false, false) },
    ]) {
      const { status } = await checkSupportReadiness(probes);
      expect(['ok', 'degraded', 'unavailable']).toContain(status);
    }
  });

  it('GET /health sigue respondiendo 200 con su forma actual aunque la base esté caída', async () => {
    const app = appCon(() => checkSupportReadiness({ database: database(false, false) }));

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['service', 'status', 'timestamp', 'uptime']);
    expect(res.body.status).toBe('OK');
  });

  it('una app sin dependencias declaradas se informa lista', async () => {
    const res = await request(appCon()).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: {}, service: 'm8-soporte' });
  });
});

describe('registerSupportRoutes', () => {
  it('no registra rutas /health: son de la app standalone', async () => {
    const express = (await import('express')).default;
    const { registerSupportRoutes } = await import('../app.js');
    const host = express();
    registerSupportRoutes(host, {
      ticketService: new TicketService(new InMemoryTicketRepository(), new NoopSupportEventPublisher()),
      legacyEvents: false,
    });

    expect((await request(host).get('/health')).status).toBe(404);
    expect((await request(host).get('/health/live')).status).toBe(404);
    expect((await request(host).get('/health/ready')).status).toBe(404);
  });
});

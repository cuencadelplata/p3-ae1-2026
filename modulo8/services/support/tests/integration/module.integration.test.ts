import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrations.js';
import { createSupportModule, type SupportModule } from '../../src/module.js';
import { createEphemeralSchema, TEST_DATABASE_URL, type EphemeralSchema } from './helpers/ephemeral-schema.js';

let db: EphemeralSchema;
let modulo: SupportModule;

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  db = await createEphemeralSchema();
  await runMigrations(db.pool, db.schema);
  vi.stubEnv('SUPPORT_DATABASE_URL', TEST_DATABASE_URL);
  vi.stubEnv('SUPPORT_DB_SCHEMA', db.schema);
  vi.stubEnv('M6_TRIPS_URL', '');
  vi.stubEnv('SUPPORT_M1_IDENTITY_URL', '');
  modulo = createSupportModule();
});

afterEach(async () => {
  await modulo.stop();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await db.drop();
});

describe('router del módulo Support solo, contra PostgreSQL real', () => {
  it('sin ningún parser previo, un cuerpo válido crea el ticket: 201', async () => {
    const app = express();
    app.use(modulo.router);

    const res = await request(app).post('/tickets').send({ tripId: 'viaje-json', motivo: 'Cobro duplicado' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tripId: 'viaje-json', motivo: 'Cobro duplicado', estado: 'ABIERTO', version: 1 });
  });
});

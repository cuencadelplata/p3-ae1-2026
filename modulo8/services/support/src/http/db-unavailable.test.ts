import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { createSupportApp } from '../app.js';
import { databaseUnavailable, SUPPORT_ERROR_CODES } from '../errors/support-error.js';
import { NoopSupportEventPublisher } from '../events/support-event-publisher.js';
import { InMemoryTicketRepository } from '../models/ticket.model.js';
import { isDatabaseUnavailableError } from '../repositories/postgres-ticket.repository.js';
import { TicketService } from '../services/ticket.service.js';

const contract = YAML.parse(fs.readFileSync(path.resolve(process.cwd(), '../../openapi/rf85-support.yaml'), 'utf8'));

afterEach(() => {
  vi.restoreAllMocks();
});

function appConRepositorioCaido() {
  const repository = new InMemoryTicketRepository();
  const caida = () => Promise.reject(databaseUnavailable(new Error('connect ECONNREFUSED 10.0.0.5:5432')));
  for (const metodo of ['crear', 'crearConClave', 'obtenerPorId', 'actualizarEstado', 'listarHistorial', 'listar'] as const) {
    vi.spyOn(repository, metodo).mockImplementation(caida as never);
  }
  const ticketService = new TicketService(repository, new NoopSupportEventPublisher());
  return createSupportApp({ ticketService, legacyEvents: false });
}

describe('SUPPORT_DB_UNAVAILABLE', () => {
  it('forma parte del catálogo de códigos', () => {
    expect(SUPPORT_ERROR_CODES).toContain('SUPPORT_DB_UNAVAILABLE');
    expect(databaseUnavailable()).toMatchObject({ status: 503, code: 'SUPPORT_DB_UNAVAILABLE' });
  });

  it.each([
    ['POST /tickets', (app: ReturnType<typeof appConRepositorioCaido>) => request(app).post('/tickets').send({ tripId: 't', motivo: 'm' })],
    [
      'POST /tickets con Idempotency-Key',
      (app: ReturnType<typeof appConRepositorioCaido>) =>
        request(app).post('/tickets').set('Idempotency-Key', 'k').send({ tripId: 't', motivo: 'm' }),
    ],
    ['GET /tickets', (app: ReturnType<typeof appConRepositorioCaido>) => request(app).get('/tickets')],
    ['GET /tickets/:id', (app: ReturnType<typeof appConRepositorioCaido>) => request(app).get('/tickets/x')],
    [
      'PATCH /tickets/:id/estado',
      (app: ReturnType<typeof appConRepositorioCaido>) => request(app).patch('/tickets/x/estado').send({ estado: 'RESUELTO' }),
    ],
    ['GET /tickets/:id/historial', (app: ReturnType<typeof appConRepositorioCaido>) => request(app).get('/tickets/x/historial')],
  ])('%s responde 503 con el formato de error, sin detalles de la base', async (_ruta, pedir) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await pedir(appConRepositorioCaido());

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: {
        code: 'SUPPORT_DB_UNAVAILABLE',
        message: 'El servicio de soporte no está disponible en este momento. Reintentá en unos instantes.',
      },
      correlationId: res.headers['x-correlation-id'],
    });
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
  });

  it('registra la causa junto al correlationId', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await request(appConRepositorioCaido()).get('/tickets').set('X-Correlation-Id', 'corr-db');

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0][1]).toEqual({
      correlationId: 'corr-db',
      cause: 'connect ECONNREFUSED 10.0.0.5:5432',
    });
  });

  it('el ejemplo del contrato OpenAPI es la respuesta real', () => {
    const ejemplo = contract.components.responses.BaseNoDisponible.content['application/json'].examples.baseCaida.value;
    const real = databaseUnavailable();

    expect(ejemplo.error).toEqual({ code: real.code, message: real.message });
  });
});

describe('isDatabaseUnavailableError', () => {
  const error = (campos: object) => Object.assign(new Error('x'), campos);

  it.each([
    ['conexión rechazada', error({ code: 'ECONNREFUSED' })],
    ['host no resuelto', error({ code: 'ENOTFOUND' })],
    ['conexión reiniciada', error({ code: 'ECONNRESET' })],
    ['intentos IPv4 e IPv6 agrupados', error({ errors: [error({ code: 'ECONNREFUSED' })] })],
    ['timeout al conectar', new Error('timeout exceeded when trying to connect')],
    ['conexión terminada', new Error('Connection terminated unexpectedly')],
    ['timeout de lectura', new Error('Query read timeout')],
    ['statement_timeout', error({ code: '57014' })],
    ['apagado del servidor', error({ code: '57P01' })],
    ['servidor arrancando', error({ code: '57P03' })],
    ['excepción de conexión', error({ code: '08006' })],
    ['demasiadas conexiones', error({ code: '53300' })],
    ['rol inexistente', error({ code: '28000' })],
    ['contraseña incorrecta', error({ code: '28P01' })],
    ['schema inexistente', error({ code: '3F000' })],
    ['tabla inexistente (migraciones pendientes)', error({ code: '42P01' })],
  ])('sí: %s', (_caso, err) => {
    expect(isDatabaseUnavailableError(err)).toBe(true);
  });

  it.each([
    ['violación de unicidad', error({ code: '23505' })],
    ['violación de CHECK', error({ code: '23514' })],
    ['error de sintaxis', error({ code: '42601' })],
    ['un error cualquiera', new Error('algo falló')],
    ['null', null],
    ['un string', 'ECONNREFUSED'],
  ])('no: %s', (_caso, err) => {
    expect(isDatabaseUnavailableError(err)).toBe(false);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Request, Response } from 'express';

import { isDatabaseUnavailable } from '../../src/db/errors';
import { DependencyUnavailableError } from '../../src/errors/dependency-unavailable.error';
import { FiscalAuthorizationRejectedError } from '../../src/integrations/fiscal-authorizer';
import { errorHandler } from '../../src/middlewares/error.middleware';

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

interface Captured {
  status?: number;
  headers: Record<string, string>;
  body?: { error: { code: string; details?: unknown } };
}

function respond(error: unknown): Captured {
  const captured: Captured = { headers: {} };
  const res = {
    headersSent: false,
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: Captured['body']) {
      captured.body = body;
      return this;
    },
  };
  const req = { method: 'GET', originalUrl: '/api/v1/receipts/trip-1' };
  errorHandler(error, req as Request, res as unknown as Response, () => undefined);
  return captured;
}

describe('Deteccion de PostgreSQL no disponible (Unit)', () => {
  it('debe reconocer los errores de conexion', () => {
    assert.equal(isDatabaseUnavailable(withCode('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED')), true);
    assert.equal(isDatabaseUnavailable(withCode('getaddrinfo ENOTFOUND postgres', 'ENOTFOUND')), true);
    assert.equal(isDatabaseUnavailable(withCode('the database system is shutting down', '57P01')), true);
    assert.equal(isDatabaseUnavailable(new Error('timeout exceeded when trying to connect')), true);
    assert.equal(isDatabaseUnavailable(new Error('Connection terminated unexpectedly')), true);
  });

  it('debe reconocer un fallo de conexion en varias direcciones (AggregateError)', () => {
    const aggregate = new AggregateError([withCode('connect ECONNREFUSED ::1:5432', 'ECONNREFUSED')], '');
    assert.equal(isDatabaseUnavailable(aggregate), true);
  });

  it('no debe confundir un error de la consulta con una caida', () => {
    assert.equal(isDatabaseUnavailable(withCode('duplicate key value', '23505')), false);
    assert.equal(isDatabaseUnavailable(withCode('relation does not exist', '42P01')), false);
    assert.equal(isDatabaseUnavailable(new Error('otro error')), false);
    assert.equal(isDatabaseUnavailable('texto'), false);
  });
});

describe('Respuesta HTTP ante dependencias caidas (Unit)', () => {
  it('PostgreSQL caido debe responder 503 DATABASE_UNAVAILABLE con Retry-After, no 500', () => {
    const res = respond(withCode('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED'));
    assert.equal(res.status, 503);
    assert.equal(res.body?.error.code, 'DATABASE_UNAVAILABLE');
    assert.equal(res.headers['retry-after'], '5');
  });

  it('el autorizador fiscal caido debe responder 503 FISCAL_SERVICE_UNAVAILABLE', () => {
    const res = respond(new DependencyUnavailableError('fiscal', 'circuito abierto', 8));
    assert.equal(res.status, 503);
    assert.equal(res.body?.error.code, 'FISCAL_SERVICE_UNAVAILABLE');
    assert.equal(res.headers['retry-after'], '8');
  });

  it('un rechazo del autorizador debe responder 422 con el motivo', () => {
    const res = respond(new FiscalAuthorizationRejectedError('AMOUNT_LIMIT_EXCEEDED', 'importe excesivo'));
    assert.equal(res.status, 422);
    assert.equal(res.body?.error.code, 'FISCAL_AUTHORIZATION_REJECTED');
    assert.deepEqual(res.body?.error.details, { code: 'AMOUNT_LIMIT_EXCEEDED', message: 'importe excesivo' });
  });
});

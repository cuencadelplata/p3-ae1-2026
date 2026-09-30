import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { env } from '../../src/config/env';
import { runMigrations } from '../../src/db/migrations';
import { DependencyUnavailableError } from '../../src/errors/dependency-unavailable.error';
import {
  createFiscalClient,
  FiscalAuthorizationRejectedError,
  type FiscalAuthorizationRequest,
} from '../../src/integrations/fiscal-authorizer';
import { toReceiptRequest } from '../../src/messaging/payment-confirmed';
import { getReceiptPdf, issueReceipt } from '../../src/services/receipt.service';
import { paymentConfirmedEvent } from '../helpers/payment-confirmed.fixture';

type Behavior = (req: IncomingMessage, res: ServerResponse) => void;

const TIMEOUT_MS = 300;
const OPEN_MS = 400;

const authorized = (res: ServerResponse): void => {
  res.writeHead(201, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ authorizationCode: '12345678901234', expiresOn: '2026-10-15', authorizedAt: new Date().toISOString() }));
};

function request(tripId = `trip-fiscal-${Date.now()}`): FiscalAuthorizationRequest {
  return { tripId, issuedAt: new Date().toISOString(), currency: 'ARS', total: 5390.5 };
}

describe('Autorizador fiscal: timeout y circuit breaker (Integration HTTP)', () => {
  let server: Server;
  let baseUrl: string;
  let behavior: Behavior = (_req, res) => authorized(res);
  let calls = 0;

  function client() {
    return createFiscalClient({ baseUrl, timeoutMs: TIMEOUT_MS, failureThreshold: 3, openDurationMs: OPEN_MS });
  }

  before(async () => {
    server = createServer((req, res) => {
      calls += 1;
      behavior(req, res);
    });
    server.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('debe devolver la autorizacion y enviar el tripId como clave de idempotencia', async () => {
    let key: string | undefined;
    behavior = (req, res) => {
      key = req.headers['idempotency-key'] as string;
      authorized(res);
    };

    const authorization = await client().authorize(request('trip-fiscal-clave'));

    assert.equal(authorization.authorizationCode, '12345678901234');
    assert.equal(authorization.expiresOn, '2026-10-15');
    assert.equal(key, 'trip-fiscal-clave');
  });

  it('no debe enviar datos personales al autorizador', async () => {
    let body = '';
    behavior = (req, res) => {
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => authorized(res));
    };

    await client().authorize(request());

    assert.deepEqual(Object.keys(JSON.parse(body) as object).sort(), ['currency', 'issuedAt', 'total', 'tripId']);
  });

  it('debe cortar la espera al vencer el timeout', async () => {
    behavior = () => undefined; // nunca responde

    const startedAt = Date.now();
    const error = await client()
      .authorize(request())
      .catch((rejection: unknown) => rejection);

    assert.ok(error instanceof DependencyUnavailableError);
    assert.equal(error.code, 'FISCAL_SERVICE_UNAVAILABLE');
    assert.match(error.message, /sin respuesta en 300 ms/);
    assert.ok(Date.now() - startedAt < TIMEOUT_MS * 4);
  });

  it('un 5xx debe informarse como dependencia no disponible', async () => {
    behavior = (_req, res) => {
      res.writeHead(503);
      res.end();
    };
    await assert.rejects(client().authorize(request()), DependencyUnavailableError);
  });

  it('una conexion rechazada debe informarse como dependencia no disponible', async () => {
    // Un puerto que estuvo abierto y se cerro: nada escucha ahi.
    const closed = createServer().listen(0);
    await new Promise<void>((resolve) => closed.once('listening', () => resolve()));
    const { port } = closed.address() as AddressInfo;
    await new Promise((resolve) => closed.close(resolve));

    const unreachable = createFiscalClient({
      baseUrl: `http://127.0.0.1:${port}`,
      timeoutMs: TIMEOUT_MS,
      failureThreshold: 3,
      openDurationMs: OPEN_MS,
    });
    const error = await unreachable.authorize(request()).catch((rejection: unknown) => rejection);
    assert.ok(error instanceof DependencyUnavailableError);
    assert.match(error.message, /ECONNREFUSED/);
    assert.equal(await unreachable.isReachable(), false);
  });

  it('un rechazo 422 debe propagarse como rechazo y no abrir el circuito', async () => {
    behavior = (_req, res) => {
      res.writeHead(422, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'AMOUNT_LIMIT_EXCEEDED', message: 'importe excesivo' } }));
    };
    const fiscal = client();

    for (let i = 0; i < 5; i += 1) {
      const error = await fiscal.authorize(request()).catch((rejection: unknown) => rejection);
      assert.ok(error instanceof FiscalAuthorizationRejectedError);
      assert.equal(error.code, 'AMOUNT_LIMIT_EXCEEDED');
    }
    assert.equal(fiscal.circuitState(), 'closed');
  });

  it('una respuesta con formato inesperado debe contarse como falla', async () => {
    behavior = (_req, res) => {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    };
    await assert.rejects(client().authorize(request()), DependencyUnavailableError);
  });

  it('tras tres fallas debe abrir el circuito, rechazar al instante y recuperarse cuando vuelve', async () => {
    const fiscal = client();
    behavior = (_req, res) => {
      res.writeHead(503);
      res.end();
    };

    for (let i = 0; i < 3; i += 1) {
      await assert.rejects(fiscal.authorize(request()), DependencyUnavailableError);
    }
    assert.equal(fiscal.circuitState(), 'open');

    // Abierto: falla al instante, sin llegar al servidor, e indica cuando reintentar.
    const before = calls;
    const error = await fiscal.authorize(request()).catch((rejection: unknown) => rejection);
    assert.ok(error instanceof DependencyUnavailableError);
    assert.match(error.message, /circuito abierto/);
    assert.ok(error.retryAfterSeconds >= 1);
    assert.equal(calls, before, 'con el circuito abierto no se debe llamar al autorizador');

    // El autorizador se recupera: pasado el tiempo abierto, la prueba lo cierra.
    behavior = (_req, res) => authorized(res);
    await new Promise((resolve) => setTimeout(resolve, OPEN_MS + 50));
    assert.equal(fiscal.circuitState(), 'half_open');

    const authorization = await fiscal.authorize(request());
    assert.equal(authorization.authorizationCode, '12345678901234');
    assert.equal(fiscal.circuitState(), 'closed');
  });
});

describe('Autorizador fiscal simulado (Integration contra el contenedor)', () => {
  const sandbox = createFiscalClient({
    baseUrl: env.fiscalApiUrl,
    timeoutMs: env.fiscalTimeoutMs,
    failureThreshold: 3,
    openDurationMs: 1000,
  });

  before(async () => {
    await runMigrations();
  });

  it('debe autorizar y devolver la misma autorizacion para el mismo viaje', async () => {
    const pedido = request(`trip-fiscal-idem-${Date.now()}`);

    const [first, second] = await Promise.all([sandbox.authorize(pedido), sandbox.authorize(pedido)]);

    assert.match(first.authorizationCode, /^\d{14}$/);
    assert.deepEqual(second, first);
  });

  it('debe rechazar un importe mayor al maximo autorizable', async () => {
    const error = await sandbox
      .authorize({ ...request(), total: 20_000_000 })
      .catch((rejection: unknown) => rejection);
    assert.ok(error instanceof FiscalAuthorizationRejectedError);
    assert.equal(error.code, 'AMOUNT_LIMIT_EXCEEDED');
  });

  it('el comprobante emitido debe guardar la autorizacion junto con su PDF', async () => {
    const tripId = `trip-fiscal-pdf-${Date.now()}`;
    const pedido = toReceiptRequest(paymentConfirmedEvent(tripId));
    assert.ok(pedido.ok);

    const { receipt } = await issueReceipt(pedido.value);
    assert.match(receipt.fiscal?.authorizationCode ?? '', /^\d{14}$/);

    const { receipt: stored, pdf } = await getReceiptPdf(tripId);
    assert.deepEqual(stored.fiscal, receipt.fiscal);
    assert.ok(pdf.length > 0);
  });
});

import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { runMigrations } from '../../src/db/migrations';
import { DependencyUnavailableError } from '../../src/errors/dependency-unavailable.error';
import { createPaymentsClient, PaymentNotAuthorizedError } from '../../src/integrations/m7-payments';
import { PermanentMessageError } from '../../src/messaging/errors';
import { processPaymentConfirmed, toReceiptRequest } from '../../src/messaging/payment-confirmed';
import type { ReceiptRequest } from '../../src/models/receipt';
import { getReceipt, issueReceipt } from '../../src/services/receipt.service';
import { paymentConfirmedEvent, toBuffer } from '../helpers/payment-confirmed.fixture';

type Behavior = (req: IncomingMessage, res: ServerResponse) => void;

const TIMEOUT_MS = 300;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function isUnavailable(error: unknown): boolean {
  return error instanceof DependencyUnavailableError && error.code === 'PAYMENTS_SERVICE_UNAVAILABLE';
}

describe('Cliente REST de M7 (Integration HTTP)', () => {
  let server: Server;
  let baseUrl: string;
  let behavior: Behavior = (_req, res) => json(res, 404, { mensaje: 'sin pago' });
  let lastPath: string | undefined;

  function client() {
    return createPaymentsClient({ baseUrl, timeoutMs: TIMEOUT_MS });
  }

  before(async () => {
    server = createServer((req, res) => {
      lastPath = req.url;
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

  it('debe consultar GET /metodo-pago/{viajeId} y traducir la respuesta', async () => {
    behavior = (_req, res) =>
      json(res, 200, { pagoId: 'p-1', clienteId: 'c-1', viajeId: 'trip-a', tipo: 'transferencia', detalle: '', fecha: '4/10/2026', estado: 'autorizado' });

    const payment = await client().getPayment('trip-a');

    assert.equal(lastPath, '/metodo-pago/trip-a');
    assert.deepEqual(payment, { paymentId: 'p-1', tripId: 'trip-a', method: 'TRANSFERENCIA', status: 'APROBADO' });
  });

  it('un 404 de M7 debe devolver null (viaje sin pago registrado)', async () => {
    behavior = (_req, res) => json(res, 404, { mensaje: 'No se encontro un pago para ese viaje' });
    assert.equal(await client().getPayment('trip-b'), null);
  });

  it('un error 5xx de M7 debe informar la dependencia como no disponible', async () => {
    behavior = (_req, res) => json(res, 500, { mensaje: 'error' });
    await assert.rejects(client().getPayment('trip-c'), isUnavailable);
  });

  it('una respuesta fuera de tiempo debe informar la dependencia como no disponible', async () => {
    behavior = (_req, res) => {
      setTimeout(() => json(res, 200, {}), TIMEOUT_MS * 3);
    };
    await assert.rejects(client().getPayment('trip-d'), isUnavailable);
  });

  it('una respuesta fuera de contrato debe informar la dependencia como no disponible', async () => {
    behavior = (_req, res) => json(res, 200, { pagoId: 'p-1', viajeId: 'trip-e', tipo: 'billetera', estado: 'autorizado' });
    await assert.rejects(client().getPayment('trip-e'), isUnavailable);
  });

  it('una respuesta de otro viaje debe informar la dependencia como no disponible', async () => {
    behavior = (_req, res) => json(res, 200, { pagoId: 'p-1', viajeId: 'otro-viaje', tipo: 'tarjeta', estado: 'autorizado' });
    await assert.rejects(client().getPayment('trip-f'), isUnavailable);
  });

  it('sin conexion con M7 debe informar la dependencia como no disponible', async () => {
    const closed = createServer().listen(0);
    await new Promise<void>((resolve) => closed.once('listening', () => resolve()));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));

    const offline = createPaymentsClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: TIMEOUT_MS });
    await assert.rejects(offline.getPayment('trip-g'), isUnavailable);
  });
});

/**
 * Flujos contra la API de M7 simulada (m7-payments-sandbox del compose), con el
 * mismo contrato de M7: el pago se registra pendiente y despues se autoriza o
 * se rechaza.
 */
describe('Emision segun el estado del pago en M7 (Integration HTTP + PostgreSQL + M7 sandbox)', () => {
  let server: Server;
  let baseUrl: string;
  let counter = 0;

  function newTripId(): string {
    counter += 1;
    return `trip-m7-${Date.now()}-${counter}`;
  }

  async function m7(path: string, body?: unknown): Promise<void> {
    const res = await fetch(`${env.m7PaymentsUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.ok(res.ok, `M7 sandbox ${path} respondio ${res.status}`);
  }

  async function registerPayment(tripId: string, tipo: string): Promise<void> {
    await m7('/metodo-pago', { clienteId: 'cli-0091', viajeId: tripId, tipo });
  }

  function receiptRequest(tripId: string): ReceiptRequest {
    const request = toReceiptRequest(paymentConfirmedEvent(tripId));
    assert.ok(request.ok);
    return request.value;
  }

  async function postReceipt(tripId: string): Promise<{ status: number; code?: string }> {
    const { data } = paymentConfirmedEvent(tripId);
    const res = await fetch(`${baseUrl}/api/v1/receipts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tripId,
        customer: data['customer'],
        driver: data['driver'],
        trip: data['trip'],
        fare: data['fare'],
        payment: { method: 'TARJETA', status: 'APROBADO' },
      }),
    });
    const body = (await res.json()) as { error?: { code: string } };
    return { status: res.status, ...(body.error ? { code: body.error.code } : {}) };
  }

  async function assertNotIssued(tripId: string): Promise<void> {
    await assert.rejects(getReceipt(tripId), { code: 'RECEIPT_NOT_FOUND' });
  }

  before(async () => {
    await runMigrations();
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('un pago pendiente no debe emitir, y al autorizarse debe emitir con el medio de pago de M7', async () => {
    const tripId = newTripId();
    await registerPayment(tripId, 'transferencia');

    await assert.rejects(
      issueReceipt(receiptRequest(tripId)),
      (error: unknown) => error instanceof PaymentNotAuthorizedError && error.code === 'PAYMENT_PENDING',
    );
    await assertNotIssued(tripId);

    await m7(`/metodo-pago/${tripId}/autorizar`);
    const { receipt, created } = await issueReceipt(receiptRequest(tripId));

    assert.equal(created, true);
    assert.equal(receipt.payment.status, 'APROBADO');
    assert.equal(receipt.payment.method, 'TRANSFERENCIA', 'el medio de pago sale de M7, no de la entrada');
  });

  it('un pago rechazado no debe emitir comprobante', async () => {
    const tripId = newTripId();
    await registerPayment(tripId, 'tarjeta');
    await m7(`/metodo-pago/${tripId}/rechazar`);

    await assert.rejects(
      issueReceipt(receiptRequest(tripId)),
      (error: unknown) => error instanceof PaymentNotAuthorizedError && error.code === 'PAYMENT_REJECTED',
    );
    await assertNotIssued(tripId);
  });

  it('POST /receipts debe responder 409 con el pago pendiente y 422 con el pago rechazado', async () => {
    const pending = newTripId();
    await registerPayment(pending, 'efectivo');
    assert.deepEqual(await postReceipt(pending), { status: 409, code: 'PAYMENT_PENDING' });

    const rejected = newTripId();
    await registerPayment(rejected, 'efectivo');
    await m7(`/metodo-pago/${rejected}/rechazar`);
    assert.deepEqual(await postReceipt(rejected), { status: 422, code: 'PAYMENT_REJECTED' });

    await m7(`/metodo-pago/${pending}/autorizar`);
    assert.equal((await postReceipt(pending)).status, 201);
  });

  it('payment.confirmed con el pago rechazado en M7 debe ir a la DLQ sin reintentos', async () => {
    const tripId = newTripId();
    await registerPayment(tripId, 'tarjeta');
    await m7(`/metodo-pago/${tripId}/rechazar`);

    await assert.rejects(
      processPaymentConfirmed(toBuffer(paymentConfirmedEvent(tripId))),
      (error: unknown) => error instanceof PermanentMessageError,
    );
  });

  it('payment.confirmed con el pago pendiente en M7 debe reintentarse descontando intentos', async () => {
    const tripId = newTripId();
    await registerPayment(tripId, 'tarjeta');

    // Ni permanente (DLQ directa) ni dependencia caida (espera sin descontar):
    // el consumidor lo trata como transitorio y lo reintenta hasta agotar intentos.
    await assert.rejects(
      processPaymentConfirmed(toBuffer(paymentConfirmedEvent(tripId))),
      (error: unknown) =>
        error instanceof PaymentNotAuthorizedError &&
        !(error instanceof PermanentMessageError) &&
        !(error instanceof DependencyUnavailableError),
    );

    await m7(`/metodo-pago/${tripId}/autorizar`);
    const outcome = await processPaymentConfirmed(toBuffer(paymentConfirmedEvent(tripId)));
    assert.equal(outcome.status, 'processed');
  });
});

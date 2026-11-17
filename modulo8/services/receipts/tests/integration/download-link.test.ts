import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { createApp } from '../../src/app';
import { closeRedis, connectRedis, redis } from '../../src/cache/redis';
import { env } from '../../src/config/env';
import { runMigrations } from '../../src/db/migrations';
import { pool } from '../../src/db/pool';
import { toReceiptRequest } from '../../src/messaging/payment-confirmed';
import { createDownloadLink } from '../../src/services/download-link.service';
import { issueReceipt } from '../../src/services/receipt.service';
import { paymentConfirmedEvent } from '../helpers/payment-confirmed.fixture';

interface DeliveryReferenceBody {
  data: { tripId: string; receiptNumber: string; url: string; expiresAt: string };
}

interface ErrorBody {
  error: { code: string };
}

const KEY_PREFIX = 'm8:receipts:link:';

describe('Enlaces temporales de descarga (Integration HTTP + Redis + PostgreSQL)', () => {
  let server: Server;
  let baseUrl: string;
  const tripId = `trip-enlace-${Date.now()}`;
  let receiptNumber: string;

  /** El enlace se arma con PUBLIC_BASE_URL; en la prueba se apunta al servidor efimero. */
  const local = (url: string): string => url.replace(env.publicBaseUrl, baseUrl);
  const tokenOf = (url: string): string => url.split('/').pop() ?? '';

  before(async () => {
    await runMigrations();
    await connectRedis();

    const request = toReceiptRequest(paymentConfirmedEvent(tripId));
    assert.ok(request.ok);
    receiptNumber = (await issueReceipt(request.value)).receipt.receiptNumber;

    await new Promise<void>((resolve) => {
      server = createApp().listen(0, () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await closeRedis();
  });

  it('delivery-reference debe devolver un enlace temporal con su vencimiento', async () => {
    const requestedAt = Date.now();
    const res = await fetch(`${baseUrl}/internal/receipts/${tripId}/delivery-reference`);
    assert.equal(res.status, 200);

    const { data } = (await res.json()) as DeliveryReferenceBody;
    assert.equal(data.tripId, tripId);
    assert.equal(data.receiptNumber, receiptNumber);
    assert.ok(data.url.startsWith(`${env.publicBaseUrl}${env.apiPrefix}/receipts/downloads/`));

    const expiresInMs = Date.parse(data.expiresAt) - requestedAt;
    assert.ok(Math.abs(expiresInMs - env.receiptLinkTtlSeconds * 1000) < 5000);
  });

  it('debe guardar un token opaco en Redis con el prefijo del servicio y el TTL configurado', async () => {
    const res = await fetch(`${baseUrl}/internal/receipts/${tripId}/delivery-reference`);
    const { data } = (await res.json()) as DeliveryReferenceBody;
    const token = tokenOf(data.url);

    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(!token.includes(tripId));
    assert.equal(await redis.get(`${KEY_PREFIX}${token}`), tripId);

    const ttl = await redis.ttl(`${KEY_PREFIX}${token}`);
    assert.ok(ttl > 0 && ttl <= env.receiptLinkTtlSeconds);
  });

  it('dos pedidos del mismo viaje deben recibir enlaces distintos', async () => {
    const urls = await Promise.all(
      [1, 2].map(async () => {
        const res = await fetch(`${baseUrl}/internal/receipts/${tripId}/delivery-reference`);
        return ((await res.json()) as DeliveryReferenceBody).data.url;
      }),
    );
    assert.notEqual(urls[0], urls[1]);
  });

  it('el enlace vigente debe descargar el PDF', async () => {
    const res = await fetch(`${baseUrl}/internal/receipts/${tripId}/delivery-reference`);
    const { data } = (await res.json()) as DeliveryReferenceBody;

    const download = await fetch(local(data.url));
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/pdf');
    assert.equal(download.headers.get('cache-control'), 'private, no-store');
    const pdf = Buffer.from(await download.arrayBuffer());
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  });

  it('un enlace vencido debe responder 410', async () => {
    const link = await createDownloadLink(tripId, 1);

    const active = await fetch(local(link.url));
    assert.equal(active.status, 200);

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const expired = await fetch(local(link.url));
    assert.equal(expired.status, 410);
    assert.equal(((await expired.json()) as ErrorBody).error.code, 'DOWNLOAD_LINK_EXPIRED');
  });

  it('un token inexistente o con formato invalido debe responder 410', async () => {
    const unknown = await fetch(`${baseUrl}${env.apiPrefix}/receipts/downloads/${'a'.repeat(43)}`);
    const malformed = await fetch(`${baseUrl}${env.apiPrefix}/receipts/downloads/${tripId}`);
    assert.equal(unknown.status, 410);
    assert.equal(malformed.status, 410);
  });

  it('delivery-reference debe responder 400 ante un tripId invalido', async () => {
    const res = await fetch(`${baseUrl}/internal/receipts/viaje%20invalido/delivery-reference`);
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as ErrorBody).error.code, 'INVALID_TRIP_ID');
  });

  it('delivery-reference debe responder 404 si el viaje no tiene comprobante', async () => {
    const res = await fetch(`${baseUrl}/internal/receipts/trip-sin-comprobante/delivery-reference`);
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as ErrorBody).error.code, 'RECEIPT_NOT_FOUND');
  });

  it('delivery-reference debe responder 409 si el comprobante no tiene PDF', async () => {
    // Situacion que el servicio no produce (el PDF se guarda en la misma transaccion),
    // pero que el contrato contempla. Se inserta el comprobante directamente.
    const withoutPdf = `trip-sin-pdf-${Date.now()}`;
    const receiptId = randomUUID();
    await pool.query(
      `INSERT INTO receipts.receipts (receipt_id, receipt_number, trip_id, issued_at, customer, driver, trip, fare, payment)
       VALUES ($1, $2, $3, now(), '{}', '{}', '{}', '{}', '{}')`,
      [receiptId, `CMP-SIN-PDF-${receiptId.slice(0, 8)}`, withoutPdf],
    );

    const res = await fetch(`${baseUrl}/internal/receipts/${withoutPdf}/delivery-reference`);
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as ErrorBody).error.code, 'RECEIPT_PDF_UNAVAILABLE');
  });
});

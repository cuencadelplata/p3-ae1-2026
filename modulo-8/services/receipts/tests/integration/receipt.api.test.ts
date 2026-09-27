import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { createApp } from '../../src/app';

describe('Receipt API (Integration HTTP)', () => {
  let server: Server;
  let baseUrl: string;
  const tripId = `trip-int-${Date.now()}`;

  before(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = (server.address() as AddressInfo).port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('GET /health debe responder 200 con status ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string };
    assert.equal(body.status, 'ok');
  });

  it('GET /api/v1/docs/openapi.json debe devolver la especificacion OpenAPI', async () => {
    const res = await fetch(`${baseUrl}/api/v1/docs/openapi.json`);
    assert.equal(res.status, 200);
    const spec = (await res.json()) as { openapi: string; info: { title: string } };
    assert.ok(spec.openapi.startsWith('3.0'));
    assert.ok(spec.info.title.includes('M8'));
  });

  it('POST /api/v1/receipts debe crear un comprobante (201 Created)', async () => {
    const payload = {
      tripId,
      customer: {
        id: 'cli-101',
        fullName: 'Juan Gualtieri',
        email: 'juan.gualtieri@example.com',
      },
      driver: {
        id: 'cnd-202',
        fullName: 'Conductor Prueba',
        vehicle: { type: 'AUTO', plate: 'UTN123' },
      },
      trip: {
        origin: 'Punto A',
        destination: 'Punto B',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        distanceKm: 10,
        durationMin: 20,
      },
      fare: { total: 5000 },
      payment: { method: 'TARJETA', status: 'APROBADO' },
    };

    const res = await fetch(`${baseUrl}/api/v1/receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as { data: { tripId: string; receiptNumber: string; pdf: { downloadUrl: string } } };
    assert.equal(body.data.tripId, tripId);
    assert.ok(body.data.receiptNumber.startsWith('CMP-'));
    assert.ok(body.data.pdf.downloadUrl.includes(tripId));
  });

  it('POST /api/v1/receipts debe ser idempotente (200 OK con el mismo comprobante)', async () => {
    const payload = {
      tripId,
      customer: { id: 'cli-101', fullName: 'Juan Gualtieri' },
      driver: { id: 'cnd-202', fullName: 'Conductor Prueba', vehicle: { type: 'AUTO', plate: 'UTN123' } },
      trip: { origin: 'Punto A', destination: 'Punto B', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), distanceKm: 10, durationMin: 20 },
      fare: { total: 5000 },
      payment: { method: 'TARJETA', status: 'APROBADO' },
    };

    const res = await fetch(`${baseUrl}/api/v1/receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { tripId: string } };
    assert.equal(body.data.tripId, tripId);
  });

  it('GET /api/v1/receipts/:tripId debe obtener los datos del comprobante (200 OK)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/receipts/${tripId}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { customer: { fullName: string } } };
    assert.equal(body.data.customer.fullName, 'Juan Gualtieri');
  });

  it('GET /api/v1/receipts/:tripId/pdf debe descargar el archivo PDF (200 OK)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/receipts/${tripId}/pdf`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('application/pdf'));
    const arrayBuffer = await res.arrayBuffer();
    assert.ok(arrayBuffer.byteLength > 100);
  });

  it('POST /api/v1/receipts/:tripId/resend debe solicitar reenvio (202 Accepted)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/receipts/${tripId}/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'EMAIL', destination: 'juan.gualtieri@example.com' }),
    });

    assert.equal(res.status, 202);
    const body = (await res.json()) as { data: { lastDelivery: { channel: string; destination: string; sentAt: string } } };
    assert.equal(body.data.lastDelivery.channel, 'EMAIL');
    assert.ok(body.data.lastDelivery.sentAt);
  });

  it('POST /api/v1/receipts con datos invalidos debe responder 422 Unprocessable', async () => {
    const res = await fetch(`${baseUrl}/api/v1/receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tripId: 'invalido' }), // faltan customer, driver, etc.
    });
    assert.equal(res.status, 422);
  });

  it('GET /api/v1/receipts con tripId inexistente debe responder 404', async () => {
    const res = await fetch(`${baseUrl}/api/v1/receipts/trip-inexistente-12345`);
    assert.equal(res.status, 404);
  });

  it('GET /api/v1/receipts con formato tripId invalido debe responder 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/receipts/id_invalido$$$`);
    assert.equal(res.status, 400);
  });
});

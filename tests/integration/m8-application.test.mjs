import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import express from 'express';

import { createM8ApplicationFromModules } from '../../dist/app.js';
import { createM8MetricsTracker } from '../../dist/observability/metrics.js';

function createModule(name, status = 'ok') {
  const router = express.Router();
  let starts = 0;
  let stops = 0;
  router.get(`/test/${name}`, (_request, response) => response.status(200).json({ module: name }));

  return {
    name,
    router,
    readiness: async () => ({ status }),
    start: () => {
      starts += 1;
    },
    stop: async () => {
      stops += 1;
    },
    lifecycle: () => ({ starts, stops }),
  };
}

async function startApplication(application) {
  const server = createServer(application.app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}

test('monta los cinco módulos, agrega health y cierra su ciclo de vida', async () => {
  const receipts = createModule('receipts');
  const qr = createModule('qr');
  const support = createModule('support');
  const notifications = createModule('notifications');
  const delivery = createModule('delivery');
  const application = createM8ApplicationFromModules({ receipts, qr, support, notifications, delivery });
  const server = await startApplication(application);

  try {
    application.start();
    for (const name of ['receipts', 'qr', 'support', 'notifications', 'delivery']) {
      const response = await fetch(`${server.url}/test/${name}`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { module: name });
    }

    const ready = await fetch(`${server.url}/health/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).status, 'ok');

    const openapi = await fetch(`${server.url}/openapi.yaml`);
    assert.equal(openapi.status, 200);
    assert.match(await openapi.text(), /openapi: 3\.0\.3/);

    await application.stop();
    for (const module of [receipts, qr, support, notifications, delivery]) {
      assert.deepEqual(module.lifecycle(), { starts: 1, stops: 1 });
    }
  } finally {
    await server.close();
  }
});

test('expone unavailable cuando un módulo crítico no está disponible', async () => {
  const application = createM8ApplicationFromModules({
    receipts: createModule('receipts', 'unavailable'),
    qr: createModule('qr'),
    support: createModule('support'),
    notifications: createModule('notifications'),
    delivery: createModule('delivery'),
  });
  const server = await startApplication(application);

  try {
    const ready = await fetch(`${server.url}/health`);
    assert.equal(ready.status, 503);
    assert.equal((await ready.json()).status, 'unavailable');
  } finally {
    await application.stop();
    await server.close();
  }
});

test('expone /metrics en formato Prometheus, clasifica por RF y excluye /health del ruido de negocio', async () => {
  const qr = createModule('qr');
  qr.router.post('/qr', (_req, res) => res.status(201).json({ token: 'tok-1' }));
  const delivery = createModule('delivery');
  delivery.router.post('/devices/tokens', (_req, res) => res.status(201).json({ ok: true }));
  const receipts = createModule('receipts');
  receipts.router.get('/api/v1/receipts/:tripId/pdf', (_req, res) => res.status(200).send('PDF'));

  const metricsTracker = createM8MetricsTracker('m8-test');
  const application = createM8ApplicationFromModules({
    receipts,
    qr,
    support: createModule('support'),
    notifications: createModule('notifications'),
    delivery,
    metricsTracker,
  });
  const server = await startApplication(application);

  try {
    await fetch(`${server.url}/health/live`);
    await fetch(`${server.url}/qr`, { method: 'POST' });
    await fetch(`${server.url}/devices/tokens`, { method: 'POST' });
    await fetch(`${server.url}/api/v1/receipts/trip-dynamic-999/pdf`);

    const metricsRes = await fetch(`${server.url}/metrics`);
    assert.equal(metricsRes.status, 200);
    const body = await metricsRes.text();

    assert.match(body, /nodejs_/);
    assert.match(body, /http_requests_total\{[^}]*route="\/qr"[^}]*rf="RF8\.2"/);
    assert.match(body, /http_requests_total\{[^}]*route="\/devices\/tokens"[^}]*rf="RF8\.7"/);
    assert.match(body, /http_requests_total\{[^}]*route="\/api\/v1\/receipts\/:tripId\/pdf"[^}]*rf="RF8\.3"/);
    assert.match(body, /m8_business_operations_total\{[^}]*rf="RF8\.2"[^}]*operation="Generación de código QR"/);
    assert.match(body, /m8_device_tokens_registered_total\{[^}]*platform="ANDROID"/);
    assert.match(body, /m8_storage_size_bytes\{[^}]*component="Volumen Total Módulo 8"/);
    assert.doesNotMatch(body, /route="\/health\/live"/);
    assert.doesNotMatch(body, /trip-dynamic-999/);
  } finally {
    await application.stop();
    await server.close();
  }
});


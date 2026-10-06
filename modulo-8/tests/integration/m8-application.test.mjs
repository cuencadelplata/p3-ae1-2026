import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import express from 'express';

import { createM8ApplicationFromModules } from '../../dist/app.js';

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

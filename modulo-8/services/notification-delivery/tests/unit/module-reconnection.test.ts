import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChannelModel } from 'amqplib';
import { createDeliveryModule } from '../../src/module.js';

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('El consumer no se recuperó dentro del tiempo esperado.');
}

test('RF8.7 reintenta el arranque y recupera el consumer tras perder RabbitMQ', async () => {
  const previousUrl = process.env.RABBITMQ_URL;
  process.env.RABBITMQ_URL = 'amqp://rabbitmq-test';
  const connections: EventEmitter[] = [];
  const disconnectedCallbacks: Array<() => void> = [];
  let attempts = 0;
  let starts = 0;
  const module = createDeliveryModule({
    retryDelayMs: 10,
    connectRabbitMq: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('RabbitMQ no disponible');
      const connection = new EventEmitter();
      Object.assign(connection, { close: async () => connection.emit('close') });
      connections.push(connection);
      return connection as ChannelModel;
    },
    createConsumer: (_connection, _service, _pool, onDisconnected) => {
      disconnectedCallbacks.push(onDisconnected);
      return {
      async start() { starts += 1; },
      async stop() {},
      isReady() { return true; },
      };
    },
  });

  try {
    module.start();
    await waitUntil(() => starts === 1);
    assert.equal(attempts, 2);
    connections[0]?.emit('close');
    await waitUntil(() => starts === 2);
    assert.equal(attempts, 3);
    disconnectedCallbacks[1]?.();
    await waitUntil(() => starts === 3);
    assert.equal(attempts, 4);
    await module.stop();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(attempts, 4, 'El apagado no debe programar otra conexión.');
  } finally {
    if (previousUrl === undefined) delete process.env.RABBITMQ_URL;
    else process.env.RABBITMQ_URL = previousUrl;
  }
});

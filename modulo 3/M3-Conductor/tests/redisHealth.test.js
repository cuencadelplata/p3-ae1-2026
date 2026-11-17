const { test, expect } = require('@playwright/test');
const path = require('path');
const {
  createMockFn,
  mockModule,
  clearModule,
  createFakeRedis
} = require('./helpers/testUtils');

const SRC = path.join(__dirname, '..', 'src');
const redisClientPath = path.join(SRC, 'config', 'redisClient.js');
const redisHealthPath = path.join(SRC, 'services', 'redisHealth.js');

const originalSetInterval = global.setInterval;
const originalClearInterval = global.clearInterval;

let scheduledCallbacks = [];
let clearedTimers = [];
let fakeTimerObjects = [];

function installFakeTimers() {
  scheduledCallbacks = [];
  clearedTimers = [];
  fakeTimerObjects = [];

  global.setInterval = (fn, ms) => {
    const timerObj = {
      id: scheduledCallbacks.length + 1,
      ms,
      unrefCalled: false,
      unref() {
        this.unrefCalled = true;
      }
    };
    scheduledCallbacks.push(fn);
    fakeTimerObjects.push(timerObj);
    return timerObj;
  };

  global.clearInterval = (timerObj) => {
    clearedTimers.push(timerObj);
  };
}

function restoreTimers() {
  global.setInterval = originalSetInterval;
  global.clearInterval = originalClearInterval;
}

function loadRedisHealthWithFakeRedis(customProps = {}) {
  const redis = {
    ...createFakeRedis(),
    ping: createMockFn().mockResolvedValue('PONG'),
    scan: createMockFn().mockResolvedValue(['0', []]),
    unlink: createMockFn().mockResolvedValue(1),
    del: createMockFn().mockResolvedValue(1),
    ...customProps
  };
  mockModule(redisClientPath, redis);
  clearModule(redisHealthPath);
  const redisHealth = require('../src/services/redisHealth');
  return { redis, redisHealth };
}

test.beforeEach(() => {
  installFakeTimers();
});

test.afterEach(() => {
  restoreTimers();
});

test.describe('redisHealth (Healthcheck e invalidación de caché de Redis)', () => {
  test('estado inicial isUp() es true', () => {
    const { redisHealth } = loadRedisHealthWithFakeRedis();

    expect(redisHealth.isUp()).toBe(true);
    expect(scheduledCallbacks.length).toBe(0);
  });

  test('markDown(err) cambia isUp() a false, inicia el intervalo de healthcheck y no duplica timers si ya está DOWN', () => {
    const { redisHealth } = loadRedisHealthWithFakeRedis();

    redisHealth.markDown(new Error('Connection refused'));

    expect(redisHealth.isUp()).toBe(false);
    expect(scheduledCallbacks.length).toBe(1);
    expect(fakeTimerObjects[0].unrefCalled).toBe(true);

    // Segunda llamada mientras ya está DOWN no debe duplicar el intervalo
    redisHealth.markDown(new Error('Still down'));
    expect(redisHealth.isUp()).toBe(false);
    expect(scheduledCallbacks.length).toBe(1);
  });

  test('markDown(err) no cambia de estado si redis.ping no es función', () => {
    const { redisHealth } = loadRedisHealthWithFakeRedis({ ping: undefined });

    redisHealth.markDown(new Error('Some error'));

    expect(redisHealth.isUp()).toBe(true);
    expect(scheduledCallbacks.length).toBe(0);
  });

  test('recuperación en el healthcheck cuando redis.ping() resuelve: invalida claves con scan + unlink, vuelve isUp() a true y detiene el timer', async () => {
    const scanResponses = [
      ['15', ['conductor:cond_001:habilitado']],
      ['0', ['conductor:cond_002:habilitado']],
      ['0', ['conductor:cond_001:disponible', 'conductor:cond_002:disponible']]
    ];
    let scanIndex = 0;

    const { redis, redisHealth } = loadRedisHealthWithFakeRedis({
      scan: createMockFn().mockImplementation(() => {
        const res = scanResponses[scanIndex] || ['0', []];
        scanIndex += 1;
        return Promise.resolve(res);
      })
    });

    redisHealth.markDown(new Error('Timeout'));
    expect(redisHealth.isUp()).toBe(false);
    expect(scheduledCallbacks.length).toBe(1);

    // Ejecutar el ciclo de healthcheck
    await scheduledCallbacks[0]();

    expect(redis.ping.calls.length).toBe(1);
    expect(redis.scan.calls).toEqual([
      ['0', 'MATCH', 'conductor:*:habilitado', 'COUNT', 100],
      ['15', 'MATCH', 'conductor:*:habilitado', 'COUNT', 100],
      ['0', 'MATCH', 'conductor:*:disponible', 'COUNT', 100]
    ]);
    expect(redis.unlink.calls).toEqual([
      ['conductor:cond_001:habilitado'],
      ['conductor:cond_002:habilitado'],
      ['conductor:cond_001:disponible', 'conductor:cond_002:disponible']
    ]);
    expect(redisHealth.isUp()).toBe(true);
    expect(clearedTimers.length).toBe(1);
    expect(clearedTimers[0]).toBe(fakeTimerObjects[0]);
  });

  test('recuperación usa fallback a redis.del cuando redis.unlink no está disponible', async () => {
    const { redis, redisHealth } = loadRedisHealthWithFakeRedis({
      unlink: undefined,
      scan: createMockFn().mockImplementation((_cursor, _m, patron) => {
        if (patron === 'conductor:*:habilitado') {
          return Promise.resolve(['0', ['conductor:cond_001:habilitado']]);
        }
        return Promise.resolve(['0', ['conductor:cond_001:disponible']]);
      })
    });

    redisHealth.markDown(new Error('Down'));
    await scheduledCallbacks[0]();

    expect(redis.del.calls).toEqual([
      ['conductor:cond_001:habilitado'],
      ['conductor:cond_001:disponible']
    ]);
    expect(redisHealth.isUp()).toBe(true);
    expect(clearedTimers.length).toBe(1);
  });

  test('si redis.ping() falla durante el healthcheck, sigue en estado DOWN para reintentar en el siguiente ciclo', async () => {
    const { redis, redisHealth } = loadRedisHealthWithFakeRedis();
    redis.ping.mockRejectedValue(new Error('Ping timeout'));

    redisHealth.markDown(new Error('Initial failure'));
    expect(redisHealth.isUp()).toBe(false);

    // Primer ciclo: ping falla
    await scheduledCallbacks[0]();

    expect(redis.ping.calls.length).toBe(1);
    expect(redis.scan.calls.length).toBe(0);
    expect(redisHealth.isUp()).toBe(false);
    expect(clearedTimers.length).toBe(0);

    // Segundo ciclo: ping se recupera
    redis.ping.mockResolvedValue('PONG');
    await scheduledCallbacks[0]();

    expect(redis.ping.calls.length).toBe(2);
    expect(redisHealth.isUp()).toBe(true);
    expect(clearedTimers.length).toBe(1);
  });
});

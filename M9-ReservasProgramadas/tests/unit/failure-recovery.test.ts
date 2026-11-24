import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { ReadinessService } from '../../src/readiness/readiness.service.js';
import { ExternalServiceError } from '../../src/errors/external-service.error.js';
import { OutboxWorker } from '../../src/messaging/outbox.worker.js';
import type { OutboxProcessor } from '../../src/messaging/outbox.processor.js';
afterEach(() => vi.useRealTimers());
describe('resiliencia y diagnostico operativo', () => {
  it('readiness informa una dependencia caida sin divulgar el error de conexion', async () => {
    const service = new ReadinessService([
      { name: 'postgres', check: async () => true },
      { name: 'redis', check: async () => false },
      {
        name: 'rabbitmq',
        check: async () => {
          throw new Error('private-connection-detail');
        },
      },
    ]);
    const response = await request(createApp({ readinessService: service })).get('/readiness');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: 'degraded',
      dependencies: { postgres: 'up', redis: 'down', rabbitmq: 'down' },
    });
    expect(response.text).not.toContain('private-connection-detail');
  });
  it('readiness se recupera cuando vuelve la dependencia; health permanece disponible', async () => {
    const check = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const app = createApp({
      readinessService: new ReadinessService([{ name: 'postgres', check }]),
    });
    await request(app).get('/readiness').expect(503);
    await request(app).get('/health').expect(200);
    await request(app).get('/readiness').expect(200);
  });
  it.each([
    [400, 'VALIDATION', 400],
    [401, 'AUTHENTICATION', 401],
    [403, 'AUTHORIZATION', 403],
    [404, 'NOT_FOUND', 404],
    [409, 'CONFLICT', 409],
    [422, 'BUSINESS_REJECTION', 422],
    [503, 'UNAVAILABLE', 503],
    [500, 'UNAVAILABLE', 503],
    [429, 'BAD_RESPONSE', 502],
  ])('clasifica el HTTP %i de M5 sin confundirlo con una aceptacion', (status, kind, expected) => {
    expect(ExternalServiceError.fromHttpStatus('M5', Number(status))).toMatchObject({
      kind,
      statusCode: expected,
    });
  });
  it('los errores de transporte conservan la causa interna y no la incluyen en el mensaje publico', () => {
    const cause = new Error('private-connection-detail');
    for (const factory of [
      ExternalServiceError.timeout,
      ExternalServiceError.unavailable,
      ExternalServiceError.badResponse,
    ]) {
      const withCause = factory('M7', cause);
      expect(withCause.cause).toBe(cause);
      expect(withCause.message).not.toContain(cause.message);
      expect(factory('M7').cause).toBeUndefined();
    }
  });
  it('el worker no solapa lotes ni duplica timers y se detiene limpiamente', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const process = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const onError = vi.fn();
    const worker = new OutboxWorker({ process } as unknown as OutboxProcessor, 100, onError);
    worker.stop();
    worker.start();
    worker.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(process).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(process).toHaveBeenCalledTimes(2);
    worker.stop();
    release();
    await vi.advanceTimersByTimeAsync(500);
    expect(process).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });
  it('el worker informa el fallo y vuelve a publicar en la siguiente ejecucion', async () => {
    vi.useFakeTimers();
    const failure = new Error('rabbit temporarily unavailable');
    const process = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const onError = vi.fn();
    const worker = new OutboxWorker({ process } as unknown as OutboxProcessor, 100, onError);
    worker.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(process).toHaveBeenCalledTimes(2);
    worker.stop();
  });
});

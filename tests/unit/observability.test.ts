import express from 'express';
import { Writable } from 'node:stream';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, requestContextMiddleware } from '../../src/observability/logging.js';
import {
  httpMetricsMiddleware,
  metricsHandler,
  metricsRegistry,
  recordCacheOperation,
  recordCircuitState
} from '../../src/observability/metrics.js';

class LogSink extends Writable {
  readonly lines: string[] = [];

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.lines.push(chunk.toString('utf8'));
    callback();
  }
}

describe('Observabilidad compartida', () => {
  afterEach(() => {
    metricsRegistry.resetMetrics();
    vi.restoreAllMocks();
  });

  it('propaga requestId al header y a cada log JSON del contexto', async () => {
    // Given
    const sink = new LogSink();
    const testLogger = createLogger(sink);
    const app = express();
    app.use(requestContextMiddleware);
    app.get('/probe', (_req, res) => {
      testLogger.info({ component: 'test' }, 'probe.complete');
      res.json({ ok: true });
    });

    // When
    const response = await request(app).get('/probe').set('X-Request-Id', 'req-123');
    const entry = JSON.parse(sink.lines[0] ?? '{}');

    // Then
    expect(response.headers['x-request-id']).toBe('req-123');
    expect(entry.requestId).toBe('req-123');
    expect(entry.msg).toBe('probe.complete');
  });

  it('serializa tipo, mensaje y stack de Error en JSON', () => {
    // Given
    const sink = new LogSink();
    const testLogger = createLogger(sink);

    // When
    testLogger.error({ err: new TypeError('boom') }, 'operation.failed');
    const entry = JSON.parse(sink.lines[0] ?? '{}');

    // Then
    expect(entry.err.type).toBe('TypeError');
    expect(entry.err.message).toBe('boom');
    expect(entry.err.stack).toContain('TypeError: boom');
  });

  it('expone métricas HTTP, de caché y de circuitos en formato Prometheus', async () => {
    // Given
    const app = express();
    app.use(httpMetricsMiddleware);
    app.get('/probe/:id', (_req, res) => res.status(204).end());
    app.get('/metrics', metricsHandler);
    recordCacheOperation('get', 'hit');
    recordCircuitState('m1', 'open');

    // When
    await request(app).get('/probe/42');
    const response = await request(app).get('/metrics');

    // Then
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('m2_http_requests_total');
    expect(response.text).toContain('m2_cache_operations_total');
    expect(response.text).toContain('m2_circuit_state');
    expect(response.text).toContain('route="/probe/:id"');
  });
});

import { testAuthentication, TEST_CLIENT_ID } from '../helpers/auth.js';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { loadTelemetryConfig } from '../../src/observability/config.js';
import { recordHttpRequest, recordTransition } from '../../src/observability/metrics.js';
import { telemetry, telemetryEnabled } from '../../src/observability/register.js';
import { persistableTraceContext, withSpan } from '../../src/observability/tracing.js';
import { InMemoryReservaRepository } from '../../src/repositories/in-memory-reserva.repository.js';
import { ReservaService } from '../../src/services/reserva.service.js';
import { fareEstimate, routeResolverDemo } from '../helpers/route.js';

describe('funcionamiento sin exportadores (telemetría apagada)', () => {
  it('la telemetría está apagada por defecto y en NODE_ENV=test', () => {
    expect(loadTelemetryConfig({}).enabled).toBe(false);
    expect(telemetryEnabled).toBe(false);
  });

  it('las llamadas de métricas y trazas son no-op y no lanzan errores', async () => {
    expect(() =>
      recordHttpRequest({
        method: 'GET',
        route: '/health',
        statusCode: 200,
        kind: 'health',
        startMs: 0,
      }),
    ).not.toThrow();
    expect(() => recordTransition('PROGRAMADA', 'ACTIVANDO')).not.toThrow();
    await expect(withSpan('noop', async () => 42)).resolves.toBe(42);
    expect(persistableTraceContext()).toBeNull();
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  it('el CRUD sigue funcionando sin cuenta cloud ni Alloy', async () => {
    const service = new ReservaService(
      new InMemoryReservaRepository(),
      { estimar: async () => fareEstimate() },
      routeResolverDemo(),
    );
    const response = await request(
      createApp({ reservaService: service, authenticate: testAuthentication }),
    )
      .post('/reservas')
      .send({
        clienteId: TEST_CLIENT_ID,
        origen: 'Origen',
        destino: 'Destino',
        vehiculo: 'AUTO',
        fechaHoraProgramada: new Date(Date.now() + 3_600_000).toISOString(),
      });
    expect(response.status).toBe(201);
  });

  it('rechaza configuraciones inválidas con un mensaje claro', () => {
    expect(() => loadTelemetryConfig({ OTEL_TRACES_SAMPLER_RATIO: '5' })).toThrow(
      /telemetría inválida/,
    );
  });
});

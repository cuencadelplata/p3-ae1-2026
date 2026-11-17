import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { createLogger, withCorrelationId } from '../../src/observability/logger';

describe('Logs estructurados (Unit)', () => {
  let lines: Array<Record<string, unknown>>;

  beforeEach(() => {
    lines = [];
    for (const level of ['info', 'warn', 'error'] as const) {
      mock.method(console, level, (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>));
    }
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('debe emitir una linea JSON con los campos comunes', () => {
    createLogger('prueba')('warn', 'algo paso', { tripId: 'trip-001' });

    assert.equal(lines.length, 1);
    const [entry] = lines;
    assert.equal(entry?.['level'], 'warn');
    assert.equal(entry?.['service'], 'm8-documentos');
    assert.equal(entry?.['component'], 'prueba');
    assert.equal(entry?.['message'], 'algo paso');
    assert.equal(entry?.['tripId'], 'trip-001');
    assert.ok(!Number.isNaN(Date.parse(String(entry?.['timestamp']))));
  });

  it('debe incluir el correlationId del contexto aunque haya llamadas asincronicas de por medio', async () => {
    const log = createLogger('prueba');

    await withCorrelationId('trip-abc', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      log('info', 'dentro del contexto');
    });
    log('info', 'fuera del contexto');

    assert.equal(lines[0]?.['correlationId'], 'trip-abc');
    assert.equal('correlationId' in (lines[1] ?? {}), false);
  });

  it('no debe mezclar el correlationId de dos procesamientos simultaneos', async () => {
    const log = createLogger('prueba');

    await Promise.all(
      ['trip-a', 'trip-b'].map((tripId, index) =>
        withCorrelationId(tripId, async () => {
          await new Promise((resolve) => setTimeout(resolve, 10 - index * 5));
          log('info', 'procesado', { tripId });
        }),
      ),
    );

    for (const entry of lines) {
      assert.equal(entry['correlationId'], entry['tripId']);
    }
  });
});

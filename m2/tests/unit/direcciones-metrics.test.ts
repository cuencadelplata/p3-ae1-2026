import { afterEach, describe, expect, it, vi } from 'vitest';

// El servicio sólo usa Prisma.TransactionIsolationLevel en tiempo de ejecución.
vi.mock('@prisma/client', () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: 'Serializable' } },
  PrismaClient: class {}
}));

import { DireccionesService } from '../../src/direcciones/service';
import { ApiError } from '../../src/direcciones/domain';
import { consume } from '../../src/messaging/broker';
import {
  metricsRegistry,
  recordOutboxPublicado,
  registerOutboxPendientes,
  recordSugerencia
} from '../../src/observability/metrics';

async function valor(nombre: string, labels: Record<string, string> = {}): Promise<number> {
  const metric = metricsRegistry.getSingleMetric(nombre);
  if (!metric) return 0;
  const { values } = await metric.get();
  const match = values.find((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val));
  return match?.value ?? 0;
}

function fakeCache(overrides: Partial<Record<'get' | 'set' | 'del', (...args: any[]) => any>> = {}) {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    ...overrides
  } as any;
}

/** Base falsa: $transaction ejecuta la función con el mismo objeto como "tx". */
function fakeDb(tx: Record<string, any>) {
  return { ...tx, $transaction: vi.fn(async (fn: (t: any) => unknown) => fn(tx)) } as any;
}

describe('Métricas de RF-2.2 Direcciones frecuentes', () => {
  afterEach(() => {
    metricsRegistry.resetMetrics();
    vi.restoreAllMocks();
  });

  it('cuenta la repetición idempotente de un alta como replay y no como alta nueva', async () => {
    // Given: la clave de idempotencia ya existe con el mismo cuerpo
    const payload = { tipo: 'ORIGEN', direccion: 'Plaza 25 de Mayo' };
    const { hash, canonical } = await import('../../src/direcciones/domain');
    const db = fakeDb({
      idempotencia: { findUnique: vi.fn(async () => ({ hash: hash(canonical(payload)), estado: 201, respuesta: { id: 'x' } })) }
    });
    const service = new DireccionesService(db, fakeCache());

    // When
    const result = await service.mutate('12', 'CREATE', 'clave-12345678', payload, 'corr');

    // Then
    expect(result.replayed).toBe(true);
    expect(await valor('m2_direcciones_operaciones_total', { operacion: 'alta', resultado: 'replay' })).toBe(1);
    expect(await valor('m2_direcciones_operaciones_total', { operacion: 'alta', resultado: 'ok' })).toBe(0);
  });

  it('registra el conflicto de versión (412) de una edición con If-Match viejo', async () => {
    // Given
    const db = fakeDb({
      idempotencia: { findUnique: vi.fn(async () => null) },
      direccion: { findFirst: vi.fn(async () => ({ id: 'd1', version: 3 })) }
    });
    const service = new DireccionesService(db, fakeCache());

    // When
    const intento = service.mutate('12', 'PATCH', 'clave-12345678', { id: 'd1', version: 2, changes: { etiqueta: 'Casa' } }, 'corr');

    // Then
    await expect(intento).rejects.toBeInstanceOf(ApiError);
    expect(await valor('m2_direcciones_operaciones_total', { operacion: 'edicion', resultado: 'conflicto_version' })).toBe(1);
  });

  it('cuenta reintentos serializables y el conflicto agotado', async () => {
    // Given: la base siempre informa conflicto de serialización
    const conflicto = Object.assign(new Error('serialization'), { code: 'P2034' });
    const db = { $transaction: vi.fn(async () => { throw conflicto; }) } as any;
    const service = new DireccionesService(db, fakeCache());
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0; }) as any);

    // When
    const intento = service.mutate('12', 'DELETE', 'clave-12345678', { id: 'd1', version: 1 }, 'corr');

    // Then
    await expect(intento).rejects.toMatchObject({ code: 'CONCURRENT_WRITE' });
    expect(await valor('m2_direcciones_reintentos_transaccion_total', { resultado: 'reintento' })).toBe(7);
    expect(await valor('m2_direcciones_reintentos_transaccion_total', { resultado: 'agotado' })).toBe(1);
    expect(await valor('m2_direcciones_operaciones_total', { operacion: 'baja', resultado: 'conflicto_concurrente' })).toBe(1);
  });

  it('distingue hit, miss y bypass de la caché de la lista', async () => {
    // Given
    const db = {
      revisionCliente: { findUnique: vi.fn(async () => ({ version: 1 })) },
      direccion: { findMany: vi.fn(async () => []) }
    } as any;
    const hit = new DireccionesService(db, fakeCache({ get: async () => '[]' }));
    const miss = new DireccionesService(db, fakeCache());
    const caido = new DireccionesService(db, fakeCache({ get: async () => { throw new Error('down'); }, set: async () => { throw new Error('down'); } }));

    // When
    await hit.list('12', {});
    await miss.list('12', {});
    await caido.list('12', {});

    // Then
    expect(await valor('m2_direcciones_cache_total', { resultado: 'hit' })).toBe(1);
    expect(await valor('m2_direcciones_cache_total', { resultado: 'miss' })).toBe(1);
    expect(await valor('m2_direcciones_cache_total', { resultado: 'bypass' })).toBe(1);
  });

  it('cuenta un viaje repetido como duplicado y no como nuevo', async () => {
    // Given: el evento ya figura en el inbox
    const db = fakeDb({ inbox: { findUnique: vi.fn(async () => ({ id: 'e1' })) } });
    const service = new DireccionesService(db, fakeCache());
    const punto = { direccion: 'Plaza 25 de Mayo' };

    // When
    await service.recordJourney({
      viajeId: 'v1', clienteId: '12', origen: punto, destino: punto,
      fechaViaje: new Date(), fechaReferencia: 'FINALIZACION', eventId: 'e1', via: 'evento_m6'
    });

    // Then
    expect(await valor('m2_direcciones_viajes_recientes_total', { via: 'evento_m6', resultado: 'duplicado' })).toBe(1);
    expect(await valor('m2_direcciones_viajes_recientes_total', { via: 'evento_m6', resultado: 'nuevo' })).toBe(0);
  });

  it('registra si la sugerencia trae regreso y cuántos candidatos ofrece', async () => {
    // When
    recordSugerencia(true, 2);
    recordSugerencia(false, 0);

    // Then
    expect(await valor('m2_direcciones_sugerencias_total', { regreso: 'si' })).toBe(1);
    expect(await valor('m2_direcciones_sugerencias_total', { regreso: 'no' })).toBe(1);
    const text = await metricsRegistry.metrics();
    expect(text).toContain('m2_direcciones_sugerencias_candidatos_bucket{le="0"} 1');
  });

  it('el consumidor cuenta procesados, reintentos, DLQ y contratos inválidos por cola', async () => {
    // Given
    const { z } = await import('zod');
    const schema = z.object({ eventId: z.string() });
    let entregar: (msg: any) => void = () => {};
    const channel = {
      consume: vi.fn(async (_q: string, cb: (msg: any) => void) => { entregar = cb; }),
      publish: vi.fn((_e: string, _k: string, _b: Buffer, _o: unknown, cb: (err?: Error) => void) => cb()),
      ack: vi.fn(),
      close: vi.fn(async () => {})
    } as any;
    const handler = vi.fn(async (event: { eventId: string }) => { if (event.eventId === 'falla') throw new Error('M6 caído'); });
    await consume(channel, 'm2.trip-completed', schema, handler);
    const msg = (body: unknown, retry?: number) => ({
      content: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
      properties: { headers: retry === undefined ? {} : { 'x-retry': retry } }
    });

    // When
    entregar(msg({ eventId: 'ok' }));
    entregar(msg({ eventId: 'falla' }));
    entregar(msg({ eventId: 'falla' }, 3));
    entregar(msg('no es json'));
    await vi.waitFor(() => expect(channel.ack).toHaveBeenCalledTimes(4));

    // Then
    const cola = 'm2.trip-completed';
    expect(await valor('m2_mensajes_consumidos_total', { cola, resultado: 'procesado' })).toBe(1);
    expect(await valor('m2_mensajes_consumidos_total', { cola, resultado: 'reintento' })).toBe(1);
    expect(await valor('m2_mensajes_consumidos_total', { cola, resultado: 'dlq' })).toBe(1);
    expect(await valor('m2_mensajes_consumidos_total', { cola, resultado: 'contrato_invalido' })).toBe(1);
  });

  it('expone pendientes y demora del outbox', async () => {
    // Given
    registerOutboxPendientes(async () => 4);
    registerOutboxPendientes(async () => 99); // una segunda llamada no duplica la métrica

    // When
    recordOutboxPublicado('FavoriteAddressChanged.v1', new Date(Date.now() - 1500));
    const text = await metricsRegistry.metrics();

    // Then
    expect(text).toContain('m2_outbox_pendientes 4');
    expect(text).toContain('m2_outbox_publicados_total{tipo="FavoriteAddressChanged.v1"} 1');
    expect(text).toMatch(/m2_outbox_demora_segundos_bucket\{le="2"\} 1/);
  });
});

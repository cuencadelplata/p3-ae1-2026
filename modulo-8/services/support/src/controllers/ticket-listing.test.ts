import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupportApp } from '../app.js';
import { NoopSupportEventPublisher } from '../events/support-event-publisher.js';
import { InMemoryTicketRepository, type Ticket } from '../models/ticket.model.js';
import { TicketService } from '../services/ticket.service.js';

let app: Express;
let repository: InMemoryTicketRepository;

beforeEach(() => {
  repository = new InMemoryTicketRepository();
  const ticketService = new TicketService(repository, new NoopSupportEventPublisher());
  app = createSupportApp({ ticketService, legacyEvents: false });
});

afterEach(() => {
  vi.useRealTimers();
});

// Crea tickets con fechas de creación controladas, un segundo después del anterior.
async function crearEnOrden(tripIds: string[], inicio = '2026-10-01T10:00:00.000Z') {
  vi.useFakeTimers({ toFake: ['Date'] });
  const creados: Ticket[] = [];
  for (const [indice, tripId] of tripIds.entries()) {
    vi.setSystemTime(new Date(Date.parse(inicio) + indice * 1000));
    creados.push(await repository.crear(tripId, `Motivo ${indice}`));
  }
  vi.useRealTimers();
  return creados;
}

function listar(query: Record<string, string | string[]> = {}) {
  return request(app).get('/tickets').query(query);
}

async function recorrerPaginas(query: Record<string, string>) {
  const paginas: Ticket[][] = [];
  let cursor: string | undefined;
  do {
    const res = await listar(cursor ? { ...query, cursor } : query);
    expect(res.status).toBe(200);
    paginas.push(res.body);
    cursor = res.headers['x-next-cursor'];
  } while (cursor);
  return paginas;
}

describe('GET /tickets: orden', () => {
  it('devuelve un array con los tickets más recientes primero', async () => {
    const [a, b, c] = await crearEnOrden(['trip-a', 'trip-b', 'trip-c']);

    const res = await listar();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map((t: Ticket) => t.id)).toEqual([c.id, b.id, a.id]);
  });

  it('a igual fecha de creación ordena por id, de forma estable', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T10:00:00.000Z'));
    const creados = [];
    for (let i = 0; i < 6; i += 1) {
      creados.push(await repository.crear('trip-x', 'Demora'));
    }
    vi.useRealTimers();
    const esperado = creados.map((t) => t.id).sort().reverse();

    const primera = (await listar()).body.map((t: Ticket) => t.id);
    const segunda = (await listar()).body.map((t: Ticket) => t.id);

    expect(primera).toEqual(esperado);
    expect(segunda).toEqual(esperado);
  });
});

describe('GET /tickets: filtros', () => {
  it('filtra por tripId', async () => {
    await crearEnOrden(['trip-a', 'trip-b', 'trip-a']);

    const res = await listar({ tripId: 'trip-a' });

    expect(res.body).toHaveLength(2);
    expect(res.body.every((t: Ticket) => t.tripId === 'trip-a')).toBe(true);
  });

  it('acepta viajeId como alias deprecado del filtro', async () => {
    await crearEnOrden(['trip-a', 'trip-b']);

    const res = await listar({ viajeId: 'trip-b' });

    expect(res.body.map((t: Ticket) => t.tripId)).toEqual(['trip-b']);
  });

  it('compara el tripId como string opaco, sin coincidencias parciales', async () => {
    await crearEnOrden(['trip-1', 'trip-10', '1']);

    expect((await listar({ tripId: 'trip-1' })).body).toHaveLength(1);
    expect((await listar({ tripId: '1' })).body).toHaveLength(1);
  });

  it('filtra por estado', async () => {
    const [a, b] = await crearEnOrden(['trip-a', 'trip-b', 'trip-c']);
    await repository.actualizarEstado(a.id, 'EN_PROCESO');
    await repository.actualizarEstado(b.id, 'RESUELTO');

    expect((await listar({ estado: 'ABIERTO' })).body).toHaveLength(1);
    expect((await listar({ estado: 'EN_PROCESO' })).body.map((t: Ticket) => t.id)).toEqual([a.id]);
    expect((await listar({ estado: 'RESUELTO' })).body.map((t: Ticket) => t.id)).toEqual([b.id]);
  });

  it('combina tripId y estado', async () => {
    const [a] = await crearEnOrden(['trip-a', 'trip-a', 'trip-b']);
    await repository.actualizarEstado(a.id, 'RESUELTO');

    const res = await listar({ tripId: 'trip-a', estado: 'RESUELTO' });

    expect(res.body.map((t: Ticket) => t.id)).toEqual([a.id]);
  });

  it('devuelve un array vacío si nada coincide', async () => {
    await crearEnOrden(['trip-a']);

    const res = await listar({ tripId: 'no-existe' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(res.headers['x-next-cursor']).toBeUndefined();
  });

  it.each([
    ['estado fuera del enum', { estado: 'CERRADO' }, 'estado'],
    ['estado en minúsculas', { estado: 'abierto' }, 'estado'],
    ['estado repetido', { estado: ['ABIERTO', 'RESUELTO'] }, 'estado'],
    ['tripId vacío', { tripId: '' }, 'tripId'],
    ['tripId repetido', { tripId: ['a', 'b'] }, 'tripId'],
    ['tripId y viajeId distintos', { tripId: 'a', viajeId: 'b' }, 'viajeId'],
  ])('responde 400 con %s', async (_caso, query, campo) => {
    const res = await listar(query as Record<string, string | string[]>);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SUPPORT_VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe(campo);
  });
});

describe('GET /tickets: paginación', () => {
  it('por defecto devuelve hasta 50 tickets y un cursor para seguir', async () => {
    await crearEnOrden(Array.from({ length: 55 }, (_, i) => `trip-${i}`));

    const primera = await listar();
    const segunda = await listar({ cursor: primera.headers['x-next-cursor'] });

    expect(primera.body).toHaveLength(50);
    expect(primera.headers['x-next-cursor']).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(segunda.body).toHaveLength(5);
    expect(segunda.headers['x-next-cursor']).toBeUndefined();
  });

  it('no envía X-Next-Cursor si no hay más resultados', async () => {
    await crearEnOrden(['trip-a', 'trip-b']);

    expect((await listar()).headers['x-next-cursor']).toBeUndefined();
    expect((await listar({ limit: '2' })).headers['x-next-cursor']).toBeUndefined();
  });

  it('recorre todos los tickets sin repetir ni saltear, en el mismo orden', async () => {
    const creados = await crearEnOrden(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    const esperado = creados.map((t) => t.id).reverse();

    const paginas = await recorrerPaginas({ limit: '3' });

    expect(paginas.map((p) => p.length)).toEqual([3, 3, 1]);
    expect(paginas.flat().map((t) => t.id)).toEqual(esperado);
  });

  it('con una cantidad múltiplo del límite, la última página no trae cursor', async () => {
    await crearEnOrden(['a', 'b', 'c', 'd']);

    const paginas = await recorrerPaginas({ limit: '2' });

    expect(paginas.map((p) => p.length)).toEqual([2, 2]);
  });

  it('pagina de forma estable cuando varios tickets comparten fecha de creación', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T10:00:00.000Z'));
    const creados = [];
    for (let i = 0; i < 7; i += 1) {
      creados.push(await repository.crear('trip-x', 'Demora'));
    }
    vi.useRealTimers();

    const paginas = await recorrerPaginas({ limit: '2' });

    expect(paginas.flat().map((t) => t.id)).toEqual(creados.map((t) => t.id).sort().reverse());
  });

  it('un ticket creado entre dos páginas no altera las siguientes', async () => {
    const creados = await crearEnOrden(['a', 'b', 'c', 'd']);
    const primera = await listar({ limit: '2' });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T00:00:00.000Z'));
    await repository.crear('nuevo', 'Demora');
    vi.useRealTimers();
    const segunda = await listar({ limit: '2', cursor: primera.headers['x-next-cursor'] });

    expect(primera.body.map((t: Ticket) => t.id)).toEqual([creados[3].id, creados[2].id]);
    expect(segunda.body.map((t: Ticket) => t.id)).toEqual([creados[1].id, creados[0].id]);
  });

  it('el cursor respeta los filtros', async () => {
    const creados = await crearEnOrden(['trip-a', 'trip-b', 'trip-a', 'trip-b', 'trip-a']);
    const deA = creados.filter((t) => t.tripId === 'trip-a').map((t) => t.id).reverse();

    const paginas = await recorrerPaginas({ tripId: 'trip-a', limit: '2' });

    expect(paginas.flat().map((t) => t.id)).toEqual(deA);
  });

  it('acepta el límite máximo de 100', async () => {
    await crearEnOrden(['a']);

    expect((await listar({ limit: '100' })).status).toBe(200);
    expect((await listar({ limit: '1' })).body).toHaveLength(1);
  });

  it.each([
    ['cero', '0'],
    ['mayor que 100', '101'],
    ['negativo', '-1'],
    ['decimal', '1.5'],
    ['no numérico', 'abc'],
    ['vacío', ''],
    ['con espacios', ' 5 '],
  ])('responde 400 con limit %s', async (_caso, limit) => {
    const res = await listar({ limit });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SUPPORT_VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ field: 'limit', reason: 'Debe ser un entero entre 1 y 100.' }]);
  });

  it.each([
    ['texto arbitrario', 'no-es-un-cursor'],
    ['vacío', ''],
    ['JSON con otra forma', Buffer.from(JSON.stringify({ a: 1 })).toString('base64url')],
    ['una fecha inválida', Buffer.from(JSON.stringify(['ayer', 'id-1'])).toString('base64url')],
    ['tipos incorrectos', Buffer.from(JSON.stringify([1, 2])).toString('base64url')],
  ])('responde 400 con un cursor ilegible: %s', async (_caso, cursor) => {
    const res = await listar({ cursor });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SUPPORT_VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ field: 'cursor', reason: 'No es un cursor válido.' }]);
  });
});

describe('InMemoryTicketRepository: listar', () => {
  it('ordena por fecha descendente, filtra y respeta limit y despuesDe', async () => {
    const [a, b, c, d] = await crearEnOrden(['trip-a', 'trip-b', 'trip-a', 'trip-a']);

    expect((await repository.listar({ limit: 10 })).map((t) => t.id)).toEqual([d.id, c.id, b.id, a.id]);
    expect((await repository.listar({ tripId: 'trip-a', limit: 2 })).map((t) => t.id)).toEqual([d.id, c.id]);
    expect(
      (await repository.listar({ limit: 10, despuesDe: { fechaCreacion: c.fechaCreacion, id: c.id } })).map((t) => t.id),
    ).toEqual([b.id, a.id]);
  });

  it('no altera el orden interno ni devuelve referencias a lo guardado', async () => {
    const [a, b] = await crearEnOrden(['trip-a', 'trip-b']);

    const listado = await repository.listar({ limit: 10 });
    listado[0].estado = 'RESUELTO';

    expect((await repository.listarTodos()).map((t) => t.id)).toEqual([a.id, b.id]);
    expect((await repository.obtenerPorId(b.id))?.estado).toBe('ABIERTO');
  });
});

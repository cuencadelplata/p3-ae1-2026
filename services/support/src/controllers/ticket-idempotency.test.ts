import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupportApp } from '../app.js';
import type { SupportEventPublisher } from '../events/support-event-publisher.js';
import { InMemoryTicketRepository } from '../models/ticket.model.js';
import { IdempotencyKeyConflictError } from '../repositories/ticket.repository.js';
import { TicketService } from '../services/ticket.service.js';

let app: Express;
let repository: InMemoryTicketRepository;
let publish: ReturnType<typeof vi.fn<SupportEventPublisher['publish']>>;

beforeEach(() => {
  repository = new InMemoryTicketRepository();
  publish = vi.fn<SupportEventPublisher['publish']>(async () => undefined);
  app = createSupportApp({ ticketService: new TicketService(repository, { publish }), legacyEvents: false });
});

function crear(body: object, clave?: string) {
  const req = request(app).post('/tickets');
  return (clave === undefined ? req : req.set('Idempotency-Key', clave)).send(body);
}

async function cantidadDeTickets() {
  return (await request(app).get('/tickets')).body.length;
}

describe('POST /tickets con Idempotency-Key', () => {
  it('misma clave y mismo pedido: 201 la primera vez y 200 con el mismo ticket después', async () => {
    const pedido = { tripId: 'trip-1', motivo: 'Demora' };

    const primera = await crear(pedido, 'clave-1');
    const segunda = await crear(pedido, 'clave-1');
    const tercera = await crear(pedido, 'clave-1');

    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(200);
    expect(tercera.status).toBe(200);
    expect(segunda.body).toEqual(primera.body);
    expect(tercera.body.id).toBe(primera.body.id);
    expect(await cantidadDeTickets()).toBe(1);
  });

  it('un reintento no duplica el historial ni vuelve a publicar ticket.creado', async () => {
    const pedido = { tripId: 'trip-1', motivo: 'Demora' };

    const primera = await crear(pedido, 'clave-1');
    await crear(pedido, 'clave-1');

    const historial = (await request(app).get(`/tickets/${primera.body.id}/historial`)).body;
    expect(historial).toHaveLength(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('{ tripId } y { viajeId } con el mismo valor cuentan como el mismo pedido', async () => {
    const primera = await crear({ tripId: 'trip-1', motivo: 'Demora' }, 'clave-1');
    const conAlias = await crear({ viajeId: 'trip-1', motivo: 'Demora' }, 'clave-1');
    const conAmbos = await crear({ viajeId: 'trip-1', tripId: 'trip-1', motivo: 'Demora' }, 'clave-1');

    expect(conAlias.status).toBe(200);
    expect(conAmbos.status).toBe(200);
    expect(conAlias.body.id).toBe(primera.body.id);
    expect(conAmbos.body.id).toBe(primera.body.id);
  });

  it('el orden de los campos del cuerpo no cambia el pedido', async () => {
    const primera = await crear({ tripId: 'trip-1', motivo: 'Demora' }, 'clave-1');
    const reordenado = await crear({ motivo: 'Demora', tripId: 'trip-1' }, 'clave-1');

    expect(reordenado.status).toBe(200);
    expect(reordenado.body.id).toBe(primera.body.id);
  });

  it.each([
    ['otro motivo', { tripId: 'trip-1', motivo: 'Cobro duplicado' }],
    ['otro viaje', { tripId: 'trip-2', motivo: 'Demora' }],
    ['otro viaje enviado como viajeId', { viajeId: 'trip-2', motivo: 'Demora' }],
  ])('misma clave con %s: 409 SUPPORT_IDEMPOTENCY_CONFLICT y ningún ticket nuevo', async (_caso, otroPedido) => {
    await crear({ tripId: 'trip-1', motivo: 'Demora' }, 'clave-1');

    const res = await crear(otroPedido, 'clave-1');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUPPORT_IDEMPOTENCY_CONFLICT');
    expect(await cantidadDeTickets()).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('claves distintas crean tickets distintos aunque el pedido sea igual', async () => {
    const pedido = { tripId: 'trip-1', motivo: 'Demora' };

    const primera = await crear(pedido, 'clave-1');
    const segunda = await crear(pedido, 'clave-2');

    expect(segunda.status).toBe(201);
    expect(segunda.body.id).not.toBe(primera.body.id);
  });

  it('sin clave cada POST crea un ticket, como en AE1', async () => {
    const pedido = { tripId: 'trip-1', motivo: 'Demora' };

    const primera = await crear(pedido);
    const segunda = await crear(pedido);

    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(201);
    expect(segunda.body.id).not.toBe(primera.body.id);
    expect(await cantidadDeTickets()).toBe(2);
  });

  it('un reintento devuelve el ticket en su estado actual', async () => {
    const pedido = { tripId: 'trip-1', motivo: 'Demora' };
    const primera = await crear(pedido, 'clave-1');
    await request(app).patch(`/tickets/${primera.body.id}/estado`).send({ estado: 'EN_PROCESO' });

    const reintento = await crear(pedido, 'clave-1');

    expect(reintento.status).toBe(200);
    expect(reintento.body).toMatchObject({ id: primera.body.id, estado: 'EN_PROCESO', version: 2 });
  });

  it('pedidos simultáneos con la misma clave crean un solo ticket', async () => {
    const pedido = { tripId: 'trip-1', motivo: 'Demora' };

    const respuestas = await Promise.all(Array.from({ length: 8 }, () => crear(pedido, 'clave-1')));

    expect(respuestas.map((res) => res.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(respuestas.map((res) => res.body.id)).size).toBe(1);
    expect(await cantidadDeTickets()).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('un pedido inválido no consume la clave', async () => {
    const invalido = await crear({ tripId: 123, motivo: 'Demora' }, 'clave-1');
    const valido = await crear({ tripId: 'trip-1', motivo: 'Demora' }, 'clave-1');

    expect(invalido.status).toBe(400);
    expect(valido.status).toBe(201);
  });
});

describe('validación de Idempotency-Key', () => {
  it.each([
    ['vacía', ''],
    ['en blanco', '   '],
  ])('rechaza una clave %s', async (_caso, clave) => {
    const res = await crear({ tripId: 'trip-1', motivo: 'Demora' }, clave);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SUPPORT_VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ field: 'Idempotency-Key', reason: 'No puede estar vacía.' }]);
    expect(await cantidadDeTickets()).toBe(0);
  });

  it('rechaza una clave de más de 255 caracteres', async () => {
    const res = await crear({ tripId: 'trip-1', motivo: 'Demora' }, 'k'.repeat(256));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SUPPORT_VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('Idempotency-Key');
    expect(await cantidadDeTickets()).toBe(0);
  });

  it('acepta una clave de exactamente 255 caracteres', async () => {
    const res = await crear({ tripId: 'trip-1', motivo: 'Demora' }, 'k'.repeat(255));

    expect(res.status).toBe(201);
  });
});

describe('InMemoryTicketRepository: crearConClave', () => {
  it('devuelve creado: false y el mismo ticket cuando la clave y la huella coinciden', async () => {
    const idempotencia = { clave: 'c-1', hash: 'h-1' };

    const primera = await repository.crearConClave('trip-1', 'Demora', idempotencia);
    const segunda = await repository.crearConClave('trip-1', 'Demora', idempotencia);

    expect(primera.creado).toBe(true);
    expect(segunda.creado).toBe(false);
    expect(segunda.ticket).toEqual(primera.ticket);
    expect(await repository.listarTodos()).toHaveLength(1);
  });

  it('lanza IdempotencyKeyConflictError si la huella es otra, sin crear nada', async () => {
    await repository.crearConClave('trip-1', 'Demora', { clave: 'c-1', hash: 'h-1' });

    await expect(
      repository.crearConClave('trip-2', 'Demora', { clave: 'c-1', hash: 'h-2' }),
    ).rejects.toBeInstanceOf(IdempotencyKeyConflictError);

    expect(await repository.listarTodos()).toHaveLength(1);
  });

  it('registra el historial inicial una sola vez', async () => {
    const idempotencia = { clave: 'c-1', hash: 'h-1' };
    const { ticket } = await repository.crearConClave('trip-1', 'Demora', idempotencia, { actor: 'pasajero-1' });
    await repository.crearConClave('trip-1', 'Demora', idempotencia, { actor: 'otro' });

    expect(await repository.listarHistorial(ticket.id)).toMatchObject([
      { estadoAnterior: null, estadoNuevo: 'ABIERTO', cambiadoPor: 'pasajero-1' },
    ]);
  });
});

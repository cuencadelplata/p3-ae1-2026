import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ticket } from '../../src/models/ticket.model.js';
import {
  IdempotencyKeyConflictError,
  TicketVersionConflictError,
  type TicketRepository,
} from '../../src/repositories/ticket.repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

// Comportamiento que debe cumplir toda implementación de TicketRepository.
// Lo ejecutan, con exactamente los mismos casos, el repositorio en memoria
// (tests unitarios) y el de PostgreSQL (tests de integración).
export function ticketRepositoryContract(
  nombre: string,
  crearRepositorio: () => TicketRepository | Promise<TicketRepository>,
): void {
  describe(`contrato de TicketRepository: ${nombre}`, () => {
    let repository: TicketRepository;

    beforeEach(async () => {
      repository = await crearRepositorio();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // Crea tickets con fechas de creación controladas. Sólo se falsea Date:
    // los timers reales siguen funcionando para el driver de la base.
    async function crearEn(fechas: string[], tripId = 'trip-1'): Promise<Ticket[]> {
      vi.useFakeTimers({ toFake: ['Date'] });
      const creados: Ticket[] = [];
      for (const fecha of fechas) {
        vi.setSystemTime(new Date(fecha));
        creados.push(await repository.crear(tripId, 'Demora'));
      }
      vi.useRealTimers();
      return creados;
    }

    describe('crear', () => {
      it('crea el ticket ABIERTO, en versión 1 y con fechas iguales en milisegundos', async () => {
        const ticket = await repository.crear('trip-1', 'El conductor no llegó');

        expect(ticket.id).toMatch(UUID);
        expect(ticket).toMatchObject({
          tripId: 'trip-1',
          viajeId: 'trip-1',
          motivo: 'El conductor no llegó',
          estado: 'ABIERTO',
          version: 1,
        });
        expect(ticket.fechaCreacion).toMatch(ISO_MS);
        expect(ticket.fechaActualizacion).toBe(ticket.fechaCreacion);
      });

      it('expone exactamente los campos del ticket', async () => {
        const ticket = await repository.crear('trip-1', 'Demora');

        expect(Object.keys(ticket).sort()).toEqual(
          ['estado', 'fechaActualizacion', 'fechaCreacion', 'id', 'motivo', 'tripId', 'version', 'viajeId'],
        );
      });

      it('guarda el tripId y el motivo como strings opacos, sin alterarlos', async () => {
        const tripId = ' 00123-ÁB/c ñ 🚕 ';
        const motivo = "Cobro 'doble'; -- \"comillas\" y\nsalto de línea";

        const ticket = await repository.crear(tripId, motivo);
        const leido = await repository.obtenerPorId(ticket.id);

        expect(leido?.tripId).toBe(tripId);
        expect(leido?.viajeId).toBe(tripId);
        expect(leido?.motivo).toBe(motivo);
      });

      it('registra la entrada inicial del historial junto con el ticket', async () => {
        const ticket = await repository.crear('trip-1', 'Demora', { actor: 'pasajero-1' });

        const historial = await repository.listarHistorial(ticket.id);

        expect(historial).toHaveLength(1);
        expect(historial[0]).toMatchObject({
          ticketId: ticket.id,
          estadoAnterior: null,
          estadoNuevo: 'ABIERTO',
          cambiadoPor: 'pasajero-1',
          motivo: null,
          fecha: ticket.fechaCreacion,
        });
      });

      it('sin actor, el historial inicial queda con cambiadoPor null', async () => {
        const ticket = await repository.crear('trip-1', 'Demora');

        expect((await repository.listarHistorial(ticket.id))[0].cambiadoPor).toBeNull();
      });
    });

    describe('obtenerPorId', () => {
      it('devuelve el ticket guardado', async () => {
        const ticket = await repository.crear('trip-1', 'Demora');

        expect(await repository.obtenerPorId(ticket.id)).toEqual(ticket);
      });

      it('devuelve undefined si no existe', async () => {
        expect(await repository.obtenerPorId(UUID_INEXISTENTE)).toBeUndefined();
      });

      it('devuelve undefined ante un id con cualquier otro formato', async () => {
        expect(await repository.obtenerPorId('no-existe')).toBeUndefined();
        expect(await repository.obtenerPorId("'; DROP TABLE tickets; --")).toBeUndefined();
      });

      it('devuelve una copia: modificarla no altera lo guardado', async () => {
        const ticket = await repository.crear('trip-1', 'Demora');
        const leido = await repository.obtenerPorId(ticket.id);
        leido!.estado = 'RESUELTO';

        expect((await repository.obtenerPorId(ticket.id))?.estado).toBe('ABIERTO');
      });
    });

    describe('actualizarEstado', () => {
      it('cambia el estado, sube la versión y actualiza la fecha', async () => {
        const [ticket] = await crearEn(['2026-10-01T10:00:00.000Z']);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-01T10:05:00.250Z'));

        const actualizado = await repository.actualizarEstado(ticket.id, 'EN_PROCESO');

        expect(actualizado).toMatchObject({
          id: ticket.id,
          estado: 'EN_PROCESO',
          version: 2,
          fechaCreacion: '2026-10-01T10:00:00.000Z',
          fechaActualizacion: '2026-10-01T10:05:00.250Z',
        });
        expect(await repository.obtenerPorId(ticket.id)).toEqual(actualizado);
      });

      it('registra el cambio en el historial, con autor y motivo', async () => {
        const ticket = await repository.crear('trip-1', 'Demora');

        await repository.actualizarEstado(ticket.id, 'EN_PROCESO', { actor: 'agente-1', motivo: 'Tomado' });
        await repository.actualizarEstado(ticket.id, 'RESUELTO');

        expect(await repository.listarHistorial(ticket.id)).toMatchObject([
          { estadoAnterior: null, estadoNuevo: 'ABIERTO' },
          { estadoAnterior: 'ABIERTO', estadoNuevo: 'EN_PROCESO', cambiadoPor: 'agente-1', motivo: 'Tomado' },
          { estadoAnterior: 'EN_PROCESO', estadoNuevo: 'RESUELTO', cambiadoPor: null, motivo: null },
        ]);
      });

      it('devuelve null si el ticket no existe, con o sin versión esperada', async () => {
        expect(await repository.actualizarEstado(UUID_INEXISTENTE, 'RESUELTO')).toBeNull();
        expect(await repository.actualizarEstado(UUID_INEXISTENTE, 'RESUELTO', { expectedVersion: 1 })).toBeNull();
        expect(await repository.actualizarEstado('no-existe', 'RESUELTO', { expectedVersion: 1 })).toBeNull();
      });

      it('con la versión esperada correcta aplica el cambio', async () => {
        const ticket = await repository.crear('trip-1', 'Demora');

        const actualizado = await repository.actualizarEstado(ticket.id, 'EN_PROCESO', { expectedVersion: 1 });

        expect(actualizado).toMatchObject({ estado: 'EN_PROCESO', version: 2 });
      });

      it('con otra versión lanza TicketVersionConflictError sin tocar el ticket ni el historial', async () => {
        const ticket = await repository.crear('trip-1', 'Demora');

        await expect(
          repository.actualizarEstado(ticket.id, 'RESUELTO', { expectedVersion: 7 }),
        ).rejects.toBeInstanceOf(TicketVersionConflictError);

        expect(await repository.obtenerPorId(ticket.id)).toEqual(ticket);
        expect(await repository.listarHistorial(ticket.id)).toHaveLength(1);
      });

      it('dos actualizaciones simultáneas con la misma versión: sólo una se aplica', async () => {
        const ticket = await repository.crear('trip-1', 'Demora');

        const resultados = await Promise.allSettled([
          repository.actualizarEstado(ticket.id, 'EN_PROCESO', { expectedVersion: 1 }),
          repository.actualizarEstado(ticket.id, 'RESUELTO', { expectedVersion: 1 }),
        ]);

        expect(resultados.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
        const rechazada = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        const aplicada = resultados.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Ticket>;
        expect(rechazada.reason).toBeInstanceOf(TicketVersionConflictError);
        expect(await repository.obtenerPorId(ticket.id)).toMatchObject({ estado: aplicada.value.estado, version: 2 });
        expect(await repository.listarHistorial(ticket.id)).toHaveLength(2);
      });
    });

    describe('crearConClave', () => {
      const idempotencia = { clave: 'clave-1', hash: 'huella-1' };

      it('la primera vez crea el ticket con su historial inicial', async () => {
        const { ticket, creado } = await repository.crearConClave('trip-1', 'Demora', idempotencia, { actor: 'p-1' });

        expect(creado).toBe(true);
        expect(ticket).toMatchObject({ tripId: 'trip-1', estado: 'ABIERTO', version: 1 });
        expect(await repository.listarHistorial(ticket.id)).toMatchObject([
          { estadoAnterior: null, estadoNuevo: 'ABIERTO', cambiadoPor: 'p-1' },
        ]);
      });

      it('con la misma clave y huella devuelve el ticket existente sin crear otro', async () => {
        const primera = await repository.crearConClave('trip-1', 'Demora', idempotencia);
        const segunda = await repository.crearConClave('trip-1', 'Demora', idempotencia, { actor: 'otro' });

        expect(segunda.creado).toBe(false);
        expect(segunda.ticket).toEqual(primera.ticket);
        expect(await repository.listar({ limit: 100 })).toHaveLength(1);
        expect(await repository.listarHistorial(primera.ticket.id)).toHaveLength(1);
      });

      it('devuelve el ticket en su estado actual', async () => {
        const { ticket } = await repository.crearConClave('trip-1', 'Demora', idempotencia);
        await repository.actualizarEstado(ticket.id, 'EN_PROCESO');

        const reintento = await repository.crearConClave('trip-1', 'Demora', idempotencia);

        expect(reintento.ticket).toMatchObject({ id: ticket.id, estado: 'EN_PROCESO', version: 2 });
      });

      it('con otra huella lanza IdempotencyKeyConflictError sin dejar tickets huérfanos', async () => {
        await repository.crearConClave('trip-1', 'Demora', idempotencia);

        await expect(
          repository.crearConClave('trip-2', 'Otro', { clave: 'clave-1', hash: 'huella-2' }),
        ).rejects.toBeInstanceOf(IdempotencyKeyConflictError);

        const tickets = await repository.listar({ limit: 100 });
        expect(tickets).toHaveLength(1);
        expect(tickets[0].tripId).toBe('trip-1');
      });

      it('claves distintas crean tickets distintos', async () => {
        const primera = await repository.crearConClave('trip-1', 'Demora', { clave: 'a', hash: 'h' });
        const segunda = await repository.crearConClave('trip-1', 'Demora', { clave: 'b', hash: 'h' });

        expect(segunda.creado).toBe(true);
        expect(segunda.ticket.id).not.toBe(primera.ticket.id);
      });

      it('pedidos simultáneos con la misma clave crean un solo ticket', async () => {
        const resultados = await Promise.all(
          Array.from({ length: 8 }, () => repository.crearConClave('trip-1', 'Demora', idempotencia)),
        );

        expect(resultados.filter((r) => r.creado)).toHaveLength(1);
        expect(new Set(resultados.map((r) => r.ticket.id)).size).toBe(1);
        expect(await repository.listar({ limit: 100 })).toHaveLength(1);
        expect(await repository.listarHistorial(resultados[0].ticket.id)).toHaveLength(1);
      });
    });

    describe('listarHistorial', () => {
      it('devuelve las entradas en orden cronológico', async () => {
        const [ticket] = await crearEn(['2026-10-01T10:00:00.000Z']);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-01T10:00:02.000Z'));
        await repository.actualizarEstado(ticket.id, 'EN_PROCESO');
        vi.setSystemTime(new Date('2026-10-01T10:00:04.000Z'));
        await repository.actualizarEstado(ticket.id, 'RESUELTO');
        vi.useRealTimers();

        const historial = await repository.listarHistorial(ticket.id);

        expect(historial.map((e) => e.fecha)).toEqual([
          '2026-10-01T10:00:00.000Z',
          '2026-10-01T10:00:02.000Z',
          '2026-10-01T10:00:04.000Z',
        ]);
      });

      it('a igual fecha conserva el orden en que se registraron los cambios', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-01T10:00:00.000Z'));
        const ticket = await repository.crear('trip-1', 'Demora');
        await repository.actualizarEstado(ticket.id, 'EN_PROCESO');
        await repository.actualizarEstado(ticket.id, 'RESUELTO');
        await repository.actualizarEstado(ticket.id, 'ABIERTO', { motivo: 'Reabierto' });
        vi.useRealTimers();

        const historial = await repository.listarHistorial(ticket.id);

        expect(historial.map((e) => e.estadoNuevo)).toEqual(['ABIERTO', 'EN_PROCESO', 'RESUELTO', 'ABIERTO']);
      });

      it('el id de cada entrada es un number creciente', async () => {
        const ticket = await repository.crear('trip-1', 'Demora');
        await repository.actualizarEstado(ticket.id, 'EN_PROCESO');

        const ids = (await repository.listarHistorial(ticket.id)).map((e) => e.id);

        expect(ids.every((id) => typeof id === 'number' && Number.isInteger(id))).toBe(true);
        expect(ids[1]).toBeGreaterThan(ids[0]);
      });

      it('no mezcla el historial de tickets distintos', async () => {
        const primero = await repository.crear('trip-1', 'Demora');
        const segundo = await repository.crear('trip-1', 'Demora');
        await repository.actualizarEstado(primero.id, 'EN_PROCESO');

        expect(await repository.listarHistorial(primero.id)).toHaveLength(2);
        expect(await repository.listarHistorial(segundo.id)).toHaveLength(1);
      });

      it('devuelve un array vacío si el ticket no existe', async () => {
        expect(await repository.listarHistorial(UUID_INEXISTENTE)).toEqual([]);
        expect(await repository.listarHistorial('no-existe')).toEqual([]);
      });
    });

    describe('listar', () => {
      it('ordena por fecha de creación descendente', async () => {
        const [a, b, c] = await crearEn([
          '2026-10-01T10:00:00.000Z',
          '2026-10-01T10:00:01.000Z',
          '2026-10-01T10:00:02.000Z',
        ]);

        expect((await repository.listar({ limit: 10 })).map((t) => t.id)).toEqual([c.id, b.id, a.id]);
      });

      it('distingue fechas que difieren en un milisegundo', async () => {
        const [a, b] = await crearEn(['2026-10-01T10:00:00.001Z', '2026-10-01T10:00:00.002Z']);

        const listado = await repository.listar({ limit: 10 });

        expect(listado.map((t) => t.id)).toEqual([b.id, a.id]);
        expect(listado.map((t) => t.fechaCreacion)).toEqual(['2026-10-01T10:00:00.002Z', '2026-10-01T10:00:00.001Z']);
      });

      it('a igual fecha desempata por id descendente', async () => {
        const fecha = '2026-10-01T10:00:00.000Z';
        const creados = await crearEn([fecha, fecha, fecha, fecha, fecha, fecha]);

        const listado = await repository.listar({ limit: 10 });

        expect(listado.map((t) => t.id)).toEqual(creados.map((t) => t.id).sort().reverse());
      });

      it('filtra por tripId exacto y por estado', async () => {
        const a = await repository.crear('trip-a', 'Demora');
        await repository.crear('trip-ab', 'Demora');
        const c = await repository.crear('trip-a', 'Demora');
        await repository.actualizarEstado(c.id, 'RESUELTO');

        expect((await repository.listar({ tripId: 'trip-a', limit: 10 })).map((t) => t.id).sort()).toEqual([a.id, c.id].sort());
        expect((await repository.listar({ estado: 'RESUELTO', limit: 10 })).map((t) => t.id)).toEqual([c.id]);
        expect((await repository.listar({ tripId: 'trip-a', estado: 'ABIERTO', limit: 10 })).map((t) => t.id)).toEqual([a.id]);
        expect(await repository.listar({ tripId: 'no-existe', limit: 10 })).toEqual([]);
      });

      it('respeta limit', async () => {
        await crearEn(['2026-10-01T10:00:00.000Z', '2026-10-01T10:00:01.000Z', '2026-10-01T10:00:02.000Z']);

        expect(await repository.listar({ limit: 2 })).toHaveLength(2);
      });

      it('despuesDe devuelve sólo los tickets posteriores en el orden del listado', async () => {
        const [a, b, c, d] = await crearEn([
          '2026-10-01T10:00:00.000Z',
          '2026-10-01T10:00:01.000Z',
          '2026-10-01T10:00:02.000Z',
          '2026-10-01T10:00:03.000Z',
        ]);

        const siguientes = await repository.listar({ limit: 10, despuesDe: { fechaCreacion: c.fechaCreacion, id: c.id } });

        expect(siguientes.map((t) => t.id)).toEqual([b.id, a.id]);
        expect(siguientes.map((t) => t.id)).not.toContain(d.id);
      });

      it('recorre por páginas todos los tickets de igual fecha sin repetir ni saltear', async () => {
        const fecha = '2026-10-01T10:00:00.000Z';
        const creados = await crearEn(Array.from({ length: 7 }, () => fecha));

        const recorridos: string[] = [];
        let despuesDe: { fechaCreacion: string; id: string } | undefined;
        for (;;) {
          const pagina = await repository.listar({ limit: 3, despuesDe });
          if (pagina.length === 0) break;
          recorridos.push(...pagina.map((t) => t.id));
          const ultimo = pagina[pagina.length - 1];
          despuesDe = { fechaCreacion: ultimo.fechaCreacion, id: ultimo.id };
        }

        expect(recorridos).toEqual(creados.map((t) => t.id).sort().reverse());
      });

      it('devuelve copias: modificarlas no altera lo guardado', async () => {
        const ticket = await repository.crear('trip-1', 'Demora');

        const listado = await repository.listar({ limit: 10 });
        listado[0].estado = 'RESUELTO';

        expect((await repository.obtenerPorId(ticket.id))?.estado).toBe('ABIERTO');
      });
    });
  });
}

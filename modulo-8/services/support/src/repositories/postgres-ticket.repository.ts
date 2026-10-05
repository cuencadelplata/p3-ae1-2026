import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { assertSchemaIdentifier } from '../db/config.js';
import { databaseUnavailable } from '../errors/support-error.js';
import type { Ticket, TicketHistoryEntry, TicketStatus } from '../models/ticket.model.js';
import { IdempotencyKeyConflictError, TicketVersionConflictError } from './ticket.repository.js';
import type {
  CambioDeEstado,
  ClaveDeIdempotencia,
  FiltroDeTickets,
  OpcionesDeCreacion,
  TicketRepository,
} from './ticket.repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Errores que significan que la base no puede atender el pedido ahora: caída,
// inalcanzable, lenta, o todavía sin el rol, el schema o las tablas.
const UNAVAILABLE_NODE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE']);
const UNAVAILABLE_PG_CODES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '57014', // query_canceled (statement_timeout)
  '53300', // too_many_connections
  '28000', // el rol no existe
  '28P01', // contraseña incorrecta
  '3F000', // el schema no existe
  '42P01', // la tabla no existe: migraciones pendientes
]);
const UNAVAILABLE_MESSAGES = /timeout exceeded when trying to connect|Connection terminated|Query read timeout|Client has encountered a connection error/i;

export function isDatabaseUnavailableError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { code, message, errors } = error as { code?: unknown; message?: unknown; errors?: unknown };

  if (typeof code === 'string' && (UNAVAILABLE_NODE_CODES.has(code) || UNAVAILABLE_PG_CODES.has(code) || code.startsWith('08'))) {
    return true;
  }
  if (typeof message === 'string' && UNAVAILABLE_MESSAGES.test(message)) {
    return true;
  }
  // Node agrupa los intentos por IPv4 e IPv6 en un AggregateError.
  return Array.isArray(errors) && errors.some(isDatabaseUnavailableError);
}

interface TicketRow {
  id: string;
  trip_id: string;
  reason: string;
  status: TicketStatus;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface HistoryRow {
  id: string;
  ticket_id: string;
  from_status: TicketStatus | null;
  to_status: TicketStatus;
  changed_by: string | null;
  reason: string | null;
  changed_at: Date;
}

function toTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    tripId: row.trip_id,
    viajeId: row.trip_id,
    motivo: row.reason,
    estado: row.status,
    version: row.version,
    fechaCreacion: row.created_at.toISOString(),
    fechaActualizacion: row.updated_at.toISOString(),
  };
}

function toHistoryEntry(row: HistoryRow): TicketHistoryEntry {
  return {
    // pg entrega bigint como string; el contrato lo expone como number.
    id: Number(row.id),
    ticketId: row.ticket_id,
    estadoAnterior: row.from_status,
    estadoNuevo: row.to_status,
    cambiadoPor: row.changed_by,
    motivo: row.reason,
    fecha: row.changed_at.toISOString(),
  };
}

// Tickets e historial en CommunicationsDB, schema de Support. Las fechas las
// asigna la aplicación con precisión de milisegundos, igual que el
// repositorio en memoria.
export class PostgresTicketRepository implements TicketRepository {
  private readonly tickets: string;
  private readonly history: string;
  private readonly keys: string;

  constructor(private readonly pool: Pool, schema: string) {
    assertSchemaIdentifier(schema);
    this.tickets = `${schema}.tickets`;
    this.history = `${schema}.ticket_history`;
    this.keys = `${schema}.idempotency_keys`;
  }

  async crear(tripId: string, motivo: string, opciones: OpcionesDeCreacion = {}): Promise<Ticket> {
    return this.transaction(async (client) => this.insertar(client, tripId, motivo, opciones));
  }

  // A lo sumo un ticket por clave, también entre procesos: la clave primaria
  // de idempotency_keys hace esperar al segundo INSERT hasta que el primero
  // confirma. Si la clave ya existía, se deshace el ticket recién insertado.
  async crearConClave(
    tripId: string,
    motivo: string,
    idempotencia: ClaveDeIdempotencia,
    opciones: OpcionesDeCreacion = {},
  ): Promise<{ ticket: Ticket; creado: boolean }> {
    const creado = await this.transaction(async (client) => {
      const ticket = await this.insertar(client, tripId, motivo, opciones);
      const { rowCount } = await client.query(
        `INSERT INTO ${this.keys} (key, request_hash, ticket_id, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO NOTHING`,
        [idempotencia.clave, idempotencia.hash, ticket.id, ticket.fechaCreacion],
      );
      // null deshace la transacción: ni el ticket ni su historial se guardan.
      return rowCount === 1 ? ticket : null;
    });
    if (creado) {
      return { ticket: creado, creado: true };
    }

    const { rows } = await this.query<TicketRow & { request_hash: string }>(
      `SELECT t.*, k.request_hash FROM ${this.keys} k JOIN ${this.tickets} t ON t.id = k.ticket_id WHERE k.key = $1`,
      [idempotencia.clave],
    );
    if (rows.length === 0) {
      throw new Error('La clave de idempotencia entró en conflicto pero no tiene un ticket asociado.');
    }
    if (rows[0].request_hash !== idempotencia.hash) {
      throw new IdempotencyKeyConflictError();
    }
    return { ticket: toTicket(rows[0]), creado: false };
  }

  async obtenerPorId(id: string): Promise<Ticket | undefined> {
    if (!UUID.test(id)) {
      return undefined;
    }
    const { rows } = await this.query<TicketRow>(`SELECT * FROM ${this.tickets} WHERE id = $1`, [id]);
    return rows[0] && toTicket(rows[0]);
  }

  // El UPDATE condicionado a la versión es la comparación y la escritura en
  // una sola sentencia; el historial se inserta en la misma transacción.
  async actualizarEstado(id: string, nuevoEstado: TicketStatus, cambio: CambioDeEstado = {}): Promise<Ticket | null> {
    if (!UUID.test(id)) {
      return null;
    }

    const resultado = await this.transaction(async (client) => {
      let version = cambio.expectedVersion;
      if (version === undefined) {
        // Sin versión esperada se toma la actual, bloqueando la fila.
        const actual = await client.query<{ version: number }>(
          `SELECT version FROM ${this.tickets} WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (actual.rows.length === 0) {
          return 'inexistente' as const;
        }
        version = actual.rows[0].version;
      }

      const ahora = new Date().toISOString();
      const actualizado = await client.query<TicketRow & { previous_status: TicketStatus }>(
        `WITH previo AS (SELECT status FROM ${this.tickets} WHERE id = $1)
         UPDATE ${this.tickets} AS t
            SET status = $2, version = t.version + 1, updated_at = $3
          WHERE t.id = $1 AND t.version = $4
         RETURNING t.*, (SELECT status FROM previo) AS previous_status`,
        [id, nuevoEstado, ahora, version],
      );
      if (actualizado.rows.length === 0) {
        const existe = await client.query(`SELECT 1 FROM ${this.tickets} WHERE id = $1`, [id]);
        return existe.rows.length === 0 ? ('inexistente' as const) : ('conflicto' as const);
      }

      const fila = actualizado.rows[0];
      await client.query(
        `INSERT INTO ${this.history} (ticket_id, from_status, to_status, changed_by, reason, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, fila.previous_status, nuevoEstado, cambio.actor ?? null, cambio.motivo ?? null, ahora],
      );
      return toTicket(fila);
    });

    if (resultado === 'inexistente') {
      return null;
    }
    if (resultado === 'conflicto') {
      throw new TicketVersionConflictError();
    }
    return resultado;
  }

  async listarHistorial(ticketId: string): Promise<TicketHistoryEntry[]> {
    if (!UUID.test(ticketId)) {
      return [];
    }
    const { rows } = await this.query<HistoryRow>(
      `SELECT * FROM ${this.history} WHERE ticket_id = $1 ORDER BY changed_at, id`,
      [ticketId],
    );
    return rows.map(toHistoryEntry);
  }

  // Paginación por posición (created_at, id): estable aunque se creen tickets
  // entre una página y la siguiente.
  async listar({ tripId, estado, limit, despuesDe }: FiltroDeTickets): Promise<Ticket[]> {
    const { rows } = await this.query<TicketRow>(
      `SELECT * FROM ${this.tickets}
        WHERE ($1::text IS NULL OR trip_id = $1)
          AND ($2::text IS NULL OR status = $2)
          AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
        ORDER BY created_at DESC, id DESC
        LIMIT $5`,
      [tripId ?? null, estado ?? null, despuesDe?.fechaCreacion ?? null, despuesDe?.id ?? null, limit],
    );
    return rows.map(toTicket);
  }

  private async insertar(
    client: PoolClient,
    tripId: string,
    motivo: string,
    opciones: OpcionesDeCreacion,
  ): Promise<Ticket> {
    const ahora = new Date().toISOString();
    const { rows } = await client.query<TicketRow>(
      `INSERT INTO ${this.tickets} (id, trip_id, reason, status, version, correlation_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'ABIERTO', 1, $2, $4, $4)
       RETURNING *`,
      [randomUUID(), tripId, motivo, ahora],
    );
    await client.query(
      `INSERT INTO ${this.history} (ticket_id, from_status, to_status, changed_by, reason, changed_at)
       VALUES ($1, NULL, 'ABIERTO', $2, NULL, $3)`,
      [rows[0].id, opciones.actor ?? null, ahora],
    );
    return toTicket(rows[0]);
  }

  private async query<Row extends object>(text: string, values: unknown[]) {
    try {
      return await this.pool.query<Row>(text, values);
    } catch (error) {
      throw this.translate(error);
    }
  }

  // Ejecuta fn en una transacción. Si fn devuelve null se deshace, igual que
  // ante un error: nunca queda un ticket sin su historial ni a medio cambiar.
  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch (error) {
      throw this.translate(error);
    }

    try {
      await client.query('BEGIN');
      const resultado = await fn(client);
      await client.query(resultado === null ? 'ROLLBACK' : 'COMMIT');
      client.release();
      return resultado;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      // Una conexión rota no vuelve al pool.
      client.release(isDatabaseUnavailableError(error) ? (error as Error) : undefined);
      throw this.translate(error);
    }
  }

  private translate(error: unknown): unknown {
    return isDatabaseUnavailableError(error) ? databaseUnavailable(error) : error;
  }
}

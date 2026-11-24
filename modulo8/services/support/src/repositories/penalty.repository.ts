import type { Pool } from 'pg';
import { assertSchemaIdentifier } from '../db/config.js';
import { databaseUnavailable } from '../errors/support-error.js';
import type { Ticket } from '../models/ticket.model.js';
import { isDatabaseUnavailableError } from './postgres-ticket.repository.js';

export interface Penalty {
  ticketId: string;
  tripId: string;
  motivo: string;
  fecha: string;
}

interface PenaltyRow {
  ticket_id: string;
  trip_id: string;
  reason: string;
  confirmed_at: Date;
}

export interface PenaltyRepository {
  confirm(ticket: Ticket, userId: number, operatorId: number, reason: string): Promise<Penalty | undefined>;
  findForTrip(userId: number, tripId: string): Promise<Penalty | undefined>;
  listActive(userId: number): Promise<Penalty[]>;
}

const COLUMNS = 'ticket_id, trip_id, reason, confirmed_at';
const PENALTY_VALIDITY_DAYS = 90;

function mapPenalty(row: PenaltyRow): Penalty {
  return { ticketId: row.ticket_id, tripId: row.trip_id, motivo: row.reason, fecha: row.confirmed_at.toISOString() };
}

export class PostgresPenaltyRepository implements PenaltyRepository {
  private readonly schema: string;

  constructor(private readonly pool: Pool, schema: string) {
    this.schema = assertSchemaIdentifier(schema);
  }

  async confirm(ticket: Ticket, userId: number, operatorId: number, reason: string): Promise<Penalty | undefined> {
    const [result] = await this.query(
      `INSERT INTO ${this.schema}.penalties
         (ticket_id, trip_id, user_id, reason, confirmed_by, confirmed_at, expires_at)
       SELECT id, trip_id, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + $6 * INTERVAL '24 hours'
       FROM ${this.schema}.tickets
       WHERE id = $1 AND version = $2 AND status = 'RESUELTO'
       FOR SHARE
       ON CONFLICT DO NOTHING
       RETURNING ${COLUMNS}`,
      [ticket.id, ticket.version, userId, reason, operatorId, PENALTY_VALIDITY_DAYS],
    );
    return result;
  }

  async findForTrip(userId: number, tripId: string): Promise<Penalty | undefined> {
    const [result] = await this.query(
      `SELECT ${COLUMNS} FROM ${this.schema}.penalties WHERE user_id = $1 AND trip_id = $2`,
      [userId, tripId],
    );
    return result;
  }

  listActive(userId: number): Promise<Penalty[]> {
    return this.query(
      `SELECT ${COLUMNS} FROM ${this.schema}.penalties
       WHERE user_id = $1 AND expires_at > CURRENT_TIMESTAMP
       ORDER BY confirmed_at DESC, ticket_id`,
      [userId],
    );
  }

  private async query(sql: string, params: unknown[]): Promise<Penalty[]> {
    try {
      const result = await this.pool.query<PenaltyRow>(sql, params);
      return result.rows.map(mapPenalty);
    } catch (error) {
      if (isDatabaseUnavailableError(error)) throw databaseUnavailable(error);
      throw error;
    }
  }
}

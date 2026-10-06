import { pool } from '../config/db.js';
import { createPolicy } from '../resilience/policies.js';
import type { AccountStatusResponse, UpdateAccountStatusInternalDTO } from '../types/customer.js';

// Misma política que el resto de las consultas a PostgreSQL: comparte el circuit breaker,
// así una base caída también corta las consultas de estado de cuenta.
const postgresPolicy = createPolicy('postgres');

type AccountStatusRow = {
  readonly customer_id: string;
  readonly status: AccountStatusResponse['status'];
  readonly reason: string;
  readonly block_origin: AccountStatusResponse['blockOrigin'] | null;
  readonly updated_at: string;
};

const FOREIGN_KEY_VIOLATION = '23503';

function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === FOREIGN_KEY_VIOLATION;
}

function statusFromRow(row: AccountStatusRow): AccountStatusResponse {
  return {
    customerId: row.customer_id,
    status: row.status,
    reason: row.reason,
    blockOrigin: row.block_origin ?? undefined,
    updatedAt: row.updated_at
  };
}

/**
 * Repositorio del estado de cuenta (RF-2.5). Separado de CustomerRepository
 * para que cada integrante trabaje en sus propios archivos.
 */
export class AccountStatusRepository {
  /**
   * Consulta el estado de cuenta y motivo de bloqueo
   */
  async findAccountStatus(customerId: string): Promise<AccountStatusResponse | null> {
    return postgresPolicy.execute(async () => {
      const query = `
        SELECT customer_id, status, reason, block_origin, updated_at
        FROM customers.AccountStatus
        WHERE customer_id = $1;
      `;
      const { rows } = await pool.query<AccountStatusRow>(query, [customerId]);
      const row = rows[0];
      return row === undefined ? null : statusFromRow(row);
    }, { idempotent: true });
  }

  /**
   * Actualiza el estado de cuenta (Soft Delete: la baja es status = INACTIVO).
   * El estado vive solo en AccountStatus (el perfil lo lee con un JOIN). Si el cliente no
   * existe, la FK a CustomerProfile rechaza el INSERT (23503) y se devuelve null.
   * Acepta blockOrigin para registrar si el bloqueo fue automático o manual.
   * No se reintenta (idempotent: false): una escritura no debe repetirse sola.
   */
  async updateAccountStatus(customerId: string, dto: UpdateAccountStatusInternalDTO): Promise<AccountStatusResponse | null> {
    return postgresPolicy.execute(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const { rows } = await client.query<AccountStatusRow>(
          `INSERT INTO customers.AccountStatus (customer_id, status, reason, block_origin, updated_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
           ON CONFLICT (customer_id) DO UPDATE
             SET status       = EXCLUDED.status,
                 reason       = EXCLUDED.reason,
                 block_origin = EXCLUDED.block_origin,
                 updated_at   = EXCLUDED.updated_at
           RETURNING customer_id, status, reason, block_origin, updated_at;`,
          [customerId, dto.status, dto.reason, dto.blockOrigin ?? null]
        );

        await client.query('COMMIT');
        const row = rows[0];
        return row === undefined ? null : statusFromRow(row);
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          await client.query('ROLLBACK').catch(() => undefined);
          return null;
        }
        // Si la conexión se cayó, el ROLLBACK también falla: no debe tapar el error original
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }, { idempotent: false });
  }
}

export const accountStatusRepository = new AccountStatusRepository();

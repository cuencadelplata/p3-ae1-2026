import { pool } from '../config/db.js';
import { createPolicy } from '../resilience/policies.js';
import { CustomerAlreadyExistsError, isDuplicateUserIdError } from '../errors/customer-already-exists.error.js';
import {
  CustomerProfileSchema,
  type CustomerProfile,
  type Preferences,
  type UserId
} from '../types/customer.js';

type CustomerProfileRow = {
  readonly customer_id: string;
  readonly user_id: number;
  readonly preferred_vehicle_type: string;
  readonly notification_channel: string;
  readonly status: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
};

const postgresPolicy = createPolicy('postgres');

function isoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function customerFromRow(row: CustomerProfileRow): CustomerProfile {
  return CustomerProfileSchema.parse({
    customerId: row.customer_id,
    userId: row.user_id,
    preferences: {
      preferredVehicleType: row.preferred_vehicle_type,
      notificationChannel: row.notification_channel
    },
    status: row.status,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at)
  });
}

export class CustomerRepository {
  /**
   * Guarda un nuevo perfil de cliente y su estado inicial en PostgreSQL
   */
  async create(customer: CustomerProfile): Promise<CustomerProfile> {
    return postgresPolicy.execute(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Insertar en CustomerProfile usando RETURNING *
        const insertProfileQuery = `
          INSERT INTO customers.CustomerProfile
            (customer_id, user_id, preferred_vehicle_type, notification_channel, status, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *;
        `;
        const profileValues = [
          customer.customerId,
          customer.userId,
          customer.preferences.preferredVehicleType,
          customer.preferences.notificationChannel,
          customer.status,
          customer.createdAt,
          customer.updatedAt ?? customer.createdAt
        ];
        await client.query(insertProfileQuery, profileValues);

        // 2. Insertar estado inicial en AccountStatus
        const insertStatusQuery = `
          INSERT INTO customers.AccountStatus (customer_id, status, reason, updated_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (customer_id) DO NOTHING;
        `;
        const statusValues = [
          customer.customerId,
          customer.status,
          'Perfil verificado y sin infracciones operativas',
          customer.createdAt
        ];
        await client.query(insertStatusQuery, statusValues);

        await client.query('COMMIT');
        return customer;
      } catch (error) {
        await client.query('ROLLBACK');
        if (isDuplicateUserIdError(error)) throw new CustomerAlreadyExistsError();
        throw error;
      } finally {
        client.release();
      }
    }, { idempotent: false });
  }

  /**
   * Busca un cliente por su ID
   */
  async findById(customerId: string): Promise<CustomerProfile | null> {
    return postgresPolicy.execute(async () => {
      const query = `
        SELECT p.customer_id, p.user_id, p.preferred_vehicle_type, p.notification_channel,
               a.status, p.created_at, p.updated_at
        FROM customers.CustomerProfile AS p
        JOIN customers.AccountStatus AS a ON a.customer_id = p.customer_id
        WHERE p.customer_id = $1;
      `;
      const { rows } = await pool.query<CustomerProfileRow>(query, [customerId]);
      const row = rows[0];
      return row === undefined ? null : customerFromRow(row);
    }, { idempotent: false });
  }

  async findByUserId(userId: UserId): Promise<CustomerProfile | null> {
    return postgresPolicy.execute(async () => {
      const query = `
        SELECT p.customer_id, p.user_id, p.preferred_vehicle_type, p.notification_channel,
               a.status, p.created_at, p.updated_at
        FROM customers.CustomerProfile AS p
        JOIN customers.AccountStatus AS a ON a.customer_id = p.customer_id
        WHERE p.user_id = $1;
      `;
      const { rows } = await pool.query<CustomerProfileRow>(query, [userId]);
      const row = rows[0];
      return row === undefined ? null : customerFromRow(row);
    }, { idempotent: true });
  }

  /**
   * Actualiza las preferencias del cliente
   */
  async updatePreferences(customerId: string, preferences: Preferences): Promise<CustomerProfile | null> {
    return postgresPolicy.execute(async () => {
      const query = `
        WITH updated AS (
          UPDATE customers.CustomerProfile
          SET preferred_vehicle_type = $1,
              notification_channel = $2,
              updated_at = CURRENT_TIMESTAMP
          WHERE customer_id = $3
          RETURNING customer_id, user_id, preferred_vehicle_type, notification_channel, created_at, updated_at
        )
        SELECT updated.customer_id, updated.user_id, updated.preferred_vehicle_type,
               updated.notification_channel, a.status, updated.created_at, updated.updated_at
        FROM updated
        JOIN customers.AccountStatus AS a ON a.customer_id = updated.customer_id;
      `;
      const values = [preferences.preferredVehicleType, preferences.notificationChannel, customerId];
      const { rows } = await pool.query<CustomerProfileRow>(query, values);
      const row = rows[0];
      return row === undefined ? null : customerFromRow(row);
    }, { idempotent: true });
  }

  /**
   * Lista todos los clientes registrados (útil para la UI)
   */
  async findAll(): Promise<CustomerProfile[]> {
    return postgresPolicy.execute(async () => {
      const query = `
        SELECT p.customer_id, p.user_id, p.preferred_vehicle_type, p.notification_channel,
               a.status, p.created_at, p.updated_at
        FROM customers.CustomerProfile AS p
        JOIN customers.AccountStatus AS a ON a.customer_id = p.customer_id
        ORDER BY p.created_at DESC;
      `;
      const { rows } = await pool.query<CustomerProfileRow>(query);
      return rows.map(customerFromRow);
    }, { idempotent: true });
  }
}

export const customerRepository = new CustomerRepository();

import { pool } from '../config/db.js';
import type { CustomerProfile, Preferences, AccountStatusResponse } from '../types/customer.js';

export class CustomerRepository {
  /**
   * Guarda un nuevo perfil de cliente y su estado inicial en PostgreSQL
   */
  async create(customer: CustomerProfile): Promise<CustomerProfile> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Insertar en CustomerProfile usando RETURNING *
      const insertProfileQuery = `
        INSERT INTO customers.CustomerProfile 
          (customer_id, name, email, phone, preferred_vehicle_type, notification_channel, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *;
      `;
      const profileValues = [
        customer.customerId,
        customer.name,
        customer.email,
        customer.phone,
        customer.preferences.preferredVehicleType,
        customer.preferences.notificationChannel,
        customer.status,
        customer.createdAt,
        customer.updatedAt || customer.createdAt
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
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Busca un cliente por su ID
   */
  async findById(customerId: string): Promise<CustomerProfile | null> {
    const query = `
      SELECT customer_id, name, email, phone, preferred_vehicle_type, notification_channel, status, created_at, updated_at
      FROM customers.CustomerProfile
      WHERE customer_id = $1;
    `;
    const { rows } = await pool.query(query, [customerId]);
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      customerId: row.customer_id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      preferences: {
        preferredVehicleType: row.preferred_vehicle_type,
        notificationChannel: row.notification_channel
      },
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Actualiza las preferencias del cliente
   */
  async updatePreferences(customerId: string, preferences: Preferences): Promise<CustomerProfile | null> {
    const query = `
      UPDATE customers.CustomerProfile
      SET preferred_vehicle_type = $1,
          notification_channel = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE customer_id = $3
      RETURNING *;
    `;
    const values = [preferences.preferredVehicleType, preferences.notificationChannel, customerId];
    const { rows } = await pool.query(query, values);
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      customerId: row.customer_id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      preferences: {
        preferredVehicleType: row.preferred_vehicle_type,
        notificationChannel: row.notification_channel
      },
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Consulta el estado de cuenta y motivo de bloqueo
   */
  async findAccountStatus(customerId: string): Promise<AccountStatusResponse | null> {
    const query = `
      SELECT customer_id, status, reason, updated_at
      FROM customers.AccountStatus
      WHERE customer_id = $1;
    `;
    const { rows } = await pool.query(query, [customerId]);
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      customerId: row.customer_id,
      status: row.status,
      reason: row.reason,
      updatedAt: row.updated_at
    };
  }

  /**
   * Lista todos los clientes registrados (útil para la UI)
   */
  async findAll(): Promise<CustomerProfile[]> {
    const query = `
      SELECT customer_id, name, email, phone, preferred_vehicle_type, notification_channel, status, created_at, updated_at
      FROM customers.CustomerProfile
      ORDER BY created_at DESC;
    `;
    const { rows } = await pool.query(query);
    return rows.map((row: any) => ({
      customerId: row.customer_id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      preferences: {
        preferredVehicleType: row.preferred_vehicle_type,
        notificationChannel: row.notification_channel
      },
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }
}

export const customerRepository = new CustomerRepository();

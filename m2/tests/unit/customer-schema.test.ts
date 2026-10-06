import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schemaSql = readFileSync(new URL('../../docker/init-db/01-schema.sql', import.meta.url), 'utf8');

describe('Esquema SQL del perfil RF-2.1', () => {
  it('vincula cada perfil con un user_id entero, obligatorio y único', () => {
    expect(schemaSql).toMatch(/user_id\s+INTEGER\s+NOT NULL\s+UNIQUE/i);
  });

  it('no duplica nombre, email ni teléfono administrados por M1', () => {
    expect(schemaSql).not.toMatch(/^\s*(name|email|phone)\s+VARCHAR/im);
  });

  it('siembra el perfil de prueba para el usuario 12', () => {
    expect(schemaSql).toMatch(/customer_id,\s*user_id,\s*preferred_vehicle_type/is);
    expect(schemaSql).toMatch(/'cust_823a7b9c',\s*12,\s*'auto'/is);
  });

  it('conserva AccountStatus y sus protecciones de borrado', () => {
    expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS customers.AccountStatus');
    expect(schemaSql).toContain('CREATE TRIGGER no_delete_account_status');
    expect(schemaSql).toContain('CREATE TRIGGER no_truncate_account_status');
  });
});

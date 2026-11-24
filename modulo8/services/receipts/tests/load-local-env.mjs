import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const envFile = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');
if (!existsSync(envFile)) {
  throw new Error('Falta modulo8/.env para las pruebas de comprobantes.');
}

const local = parse(readFileSync(envFile));
const get = (name, fallback = '') => process.env[name] || local[name] || fallback;
const required = (name) => {
  const value = get(name);
  if (!value || value.startsWith('replace-with-')) {
    throw new Error(`Configurar ${name} en modulo8/.env antes de probar comprobantes.`);
  }
  return value;
};

const db = new URL('postgres://127.0.0.1');
db.username = 'm8_receipts';
db.password = required('RECEIPTS_DB_PASSWORD');
db.port = get('POSTGRES_HOST_PORT', '5432');
db.pathname = `/${get('POSTGRES_DB', 'm8')}`;

process.env.RECEIPTS_DATABASE_URL ||= db.toString();
process.env.RABBITMQ_URL ||= required('RABBITMQ_URL');
process.env.REDIS_URL ||= `redis://127.0.0.1:${get('REDIS_HOST_PORT', '6379')}`;
process.env.M7_PAYMENTS_URL ||= `http://127.0.0.1:${get('M7_HOST_PORT', '4020')}`;

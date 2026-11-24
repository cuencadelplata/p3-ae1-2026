import { randomBytes } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';

if (!process.env.GITHUB_ENV) {
  throw new Error('Este script solo se ejecuta en GitHub Actions.');
}

const secret = () => randomBytes(24).toString('hex');
const rabbitUser = 'm8_ci';
const rabbitPassword = secret();
const postgresPassword = secret();
const values = {
  M1_JWT_SECRET: secret(),
  M2_INTERNAL_API_KEY: secret(),
  QR_INTERNAL_API_KEY: secret(),
  RABBITMQ_USER: rabbitUser,
  RABBITMQ_PASSWORD: rabbitPassword,
  M8_RABBITMQ_URL: `amqp://${rabbitUser}:${rabbitPassword}@rabbitmq:5672`,
  RABBITMQ_URL: `amqp://${rabbitUser}:${rabbitPassword}@localhost:5672`,
  POSTGRES_USER: 'm8_admin',
  POSTGRES_DB: 'm8',
  POSTGRES_PASSWORD: postgresPassword,
  RECEIPTS_DB_PASSWORD: secret(),
  NOTIFICATIONS_DB_PASSWORD: secret(),
  SUPPORT_DB_PASSWORD: secret(),
  DELIVERY_DB_PASSWORD: secret(),
  POSTGRES_URL: `postgres://m8_admin:${postgresPassword}@localhost:5432/m8`,
  POSTGRES_E2E_URL: `postgres://m8_admin:${postgresPassword}@localhost:5432/m8`,
  SUPPORT_TEST_DATABASE_URL: `postgres://m8_admin:${postgresPassword}@localhost:5432/m8`,
  RABBITMQ_API_CREDENTIALS: `${rabbitUser}:${rabbitPassword}`,
};

const content = Object.entries(values).map(([name, value]) => `${name}=${value}\n`).join('');
writeFileSync('.env', content, { mode: 0o600, flag: 'wx' });
appendFileSync(process.env.GITHUB_ENV, content);
console.log('Configuración temporal de CI generada en modulo8/.env.');

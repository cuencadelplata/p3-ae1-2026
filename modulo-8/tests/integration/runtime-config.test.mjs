import assert from 'node:assert/strict';
import test from 'node:test';

import { validateM8RuntimeConfig } from '../../dist/runtime-config.js';

const configured = {
  RABBITMQ_URL: 'amqp://user:private-value@rabbitmq:5672',
  NOTIFICATIONS_DATABASE_URL: 'postgres://user:private-value@postgres:5432/m8',
  DELIVERY_DATABASE_URL: 'postgres://user:private-value@postgres:5432/m8',
  RECEIPTS_DATABASE_URL: 'postgres://user:private-value@postgres:5432/m8',
  SUPPORT_DATABASE_URL: 'postgres://user:private-value@postgres:5432/m8',
  REDIS_URL: 'redis://redis:6379',
  M1_IDENTITY_URL: 'http://m1:4011/auth/validar-identidad-y-rol',
  M2_API_URL: 'http://m2:3002',
  M7_PAYMENTS_URL: 'http://m7:4020',
  FISCAL_API_URL: 'http://fiscal:4010',
  M1_JWT_SECRET: 'private-value',
  M2_INTERNAL_API_KEY: 'private-value',
};

test('la app única acepta configuración externa completa', () => {
  assert.doesNotThrow(() => validateM8RuntimeConfig(configured));
});

test('la app única falla antes de abrir el puerto si falta una credencial', () => {
  assert.throws(
    () => validateM8RuntimeConfig({ ...configured, M2_INTERNAL_API_KEY: '' }),
    /M2_INTERNAL_API_KEY/,
  );
});

test('un error de URL identifica la variable sin mostrar su contraseña', () => {
  assert.throws(
    () => validateM8RuntimeConfig({ ...configured, RABBITMQ_URL: 'http://user:private-value@rabbitmq' }),
    (error) => error.message.includes('RABBITMQ_URL') && !error.message.includes('private-value'),
  );
});

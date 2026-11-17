import 'dotenv/config';

import { z } from 'zod';

const urlWithDefault = (defaultValue: string) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().default(defaultValue),
  );

const stringWithDefault = (defaultValue: string) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(1).default(defaultValue),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  M5_BASE_URL: urlWithDefault('http://localhost:3001'),
  M7_BASE_URL: urlWithDefault('http://localhost:3002'),
  M5_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),
  M7_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),
  DISPATCH_MODE: z.enum(['rest', 'events']).default('events'),
  M5_SERVICE_TOKEN: z.string().optional(),
  ROUTE_RESOLVER_MODE: z.enum(['blocked', 'stub']).default('blocked'),
  ROUTE_STUB_ORIGIN_LATITUDE: z.coerce.number().min(-90).max(90).default(-27.4514),
  ROUTE_STUB_ORIGIN_LONGITUDE: z.coerce.number().min(-180).max(180).default(-58.9867),
  ROUTE_STUB_DESTINATION_LATITUDE: z.coerce.number().min(-90).max(90).default(-27.4692),
  ROUTE_STUB_DESTINATION_LONGITUDE: z.coerce.number().min(-180).max(180).default(-58.8306),
  ROUTE_STUB_DISTANCE_KM: z.coerce.number().positive().default(18.4),
  ROUTE_STUB_DURATION_MIN: z.coerce.number().positive().default(28),
  DATABASE_URL: stringWithDefault(
    'postgresql://m9:m9-local@localhost:5432/m9_reservas?schema=public',
  ),
  REDIS_URL: urlWithDefault('redis://localhost:6379'),
  REDIS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  REDIS_LOCK_TTL_MS: z.coerce.number().int().positive().default(10_000),
  RABBITMQ_URL: urlWithDefault('amqp://guest:guest@localhost:5672'),
  RABBITMQ_EXCHANGE: stringWithDefault('m9.reservas.events'),
  RABBITMQ_RETRY_EXCHANGE: stringWithDefault('m9.reservas.events.retry'),
  RABBITMQ_DLQ_EXCHANGE: stringWithDefault('m9.reservas.events.dlx'),
  RABBITMQ_QUEUE: stringWithDefault('m9.reservas'),
  RABBITMQ_RETRY_QUEUE: stringWithDefault('m9.reservas.retry'),
  RABBITMQ_DLQ: stringWithDefault('m9.reservas.dlq'),
  RABBITMQ_RETRY_LIMIT: z.coerce.number().int().positive().default(3),
  RABBITMQ_RETRY_DELAY_MS: z.coerce.number().int().nonnegative().default(1_000),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  RESERVATION_JOB_INTERVAL: stringWithDefault('*/30 * * * * *'),
});

const parsedEnv = envSchema.safeParse({
  ...process.env,
  M5_BASE_URL: process.env.M5_BASE_URL ?? process.env.M5_URL,
  M7_BASE_URL: process.env.M7_BASE_URL ?? process.env.M7_URL,
});

if (!parsedEnv.success) {
  const details = parsedEnv.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');

  throw new Error(`Configuración de entorno inválida: ${details}`);
}

export const env = Object.freeze(parsedEnv.data);
export type Environment = z.infer<typeof envSchema>;

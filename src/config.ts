export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/historial",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  rabbitUrl: process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672",
  cargoCancelacionUrl: process.env.CARGO_CANCELACION_URL ?? "http://localhost:3000",
  idempotenciaTtlSegundos: Number(process.env.IDEMPOTENCIA_TTL ?? 3600),
  maxIntentos: Number(process.env.MAX_INTENTOS ?? 3),
};

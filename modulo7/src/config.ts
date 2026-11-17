function requerir(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: requerir("DATABASE_URL"),
  redisUrl: requerir("REDIS_URL"),
  rabbitUrl: requerir("RABBITMQ_URL"),
  apiKey: requerir("M7_API_KEY"),
  mpAccessToken: requerir("MP_ACCESS_TOKEN"),
  mpBaseUrl: process.env.MP_BASE_URL ?? "https://api.mercadopago.com",
  cargoCancelacionUrl: process.env.CARGO_CANCELACION_URL ?? "http://localhost:3007",
  idempotenciaTtlSegundos: Number(process.env.IDEMPOTENCIA_TTL ?? 3600),
  maxIntentos: Number(process.env.MAX_INTENTOS ?? 3),
};
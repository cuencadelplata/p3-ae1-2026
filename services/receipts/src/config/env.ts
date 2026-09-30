import dotenv from 'dotenv';

dotenv.config({ quiet: true });

function readText(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

function readPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`La variable de entorno ${name} debe ser un puerto valido (1-65535). Valor recibido: "${raw}"`);
  }
  return parsed;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`La variable de entorno ${name} debe ser un entero positivo. Valor recibido: "${raw}"`);
  }
  return parsed;
}

// Normaliza a la forma "/segmento" para que las rutas montadas no dependan de como
// se escriba la variable en el .env.
function readPathPrefix(name: string, fallback: string): string {
  const value = readText(name, fallback).replace(/\/+$/, '');
  return value.startsWith('/') ? value : `/${value}`;
}

const port = readPort('PORT', 3008);

export const env = {
  nodeEnv: readText('NODE_ENV', 'development'),
  serviceName: 'm8-documentos',
  serviceVersion: readText('SERVICE_VERSION', '1.0.0'),
  port,

  /** Prefijo de la API REST versionada. */
  apiPrefix: readPathPrefix('API_PREFIX', '/api/v1'),

  /** URL base usada para construir los enlaces de descarga devueltos por la API. */
  publicBaseUrl: readText('PUBLIC_BASE_URL', `http://localhost:${port}`).replace(/\/+$/, ''),

  /** Origenes permitidos por CORS. "*" habilita cualquier origen. */
  corsOrigin: readText('CORS_ORIGIN', '*'),

  /**
   * Conexion a PostgreSQL con el rol propio del servicio, que solo tiene
   * permisos sobre el esquema "receipts" (RNF-04).
   */
  databaseUrl: readText(
    'RECEIPTS_DATABASE_URL',
    'postgres://m8_receipts:m8_receipts_local@localhost:5432/m8',
  ),

  /** Redis guarda solo datos efimeros: los enlaces temporales de descarga. */
  redisUrl: readText('REDIS_URL', 'redis://localhost:6379'),

  /** Vigencia de un enlace temporal de descarga del PDF, en segundos. */
  receiptLinkTtlSeconds: readPositiveInt('RECEIPT_LINK_TTL_SECONDS', 900),

  /** Mensajeria segun el catalogo de eventos v1 (modulo-8/contracts/events). */
  rabbitmqUrl: readText('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672'),
  eventsExchange: readText('EVENTS_EXCHANGE', 'mobility.events'),
  deadLetterExchange: readText('EVENTS_DEAD_LETTER_EXCHANGE', 'mobility.events.dlx'),
  paymentConfirmedQueue: readText('PAYMENT_CONFIRMED_QUEUE', 'm8.receipts.payment-confirmed'),

  /** Mensajes que el consumidor procesa a la vez antes de confirmar. */
  consumerPrefetch: readPositiveInt('CONSUMER_PREFETCH', 5),

  /** Reintentos ante fallos transitorios antes de enviar el mensaje a la DLQ. */
  consumerMaxRetries: readPositiveInt('CONSUMER_MAX_RETRIES', 3),

  /** Espera entre reintentos, en milisegundos. */
  consumerRetryDelayMs: readPositiveInt('CONSUMER_RETRY_DELAY_MS', 5000),

  /** Espera entre revisiones de la bandeja de salida de eventos, en milisegundos. */
  outboxPollIntervalMs: readPositiveInt('OUTBOX_POLL_INTERVAL_MS', 1000),

  /** Eventos que se publican por revision de la bandeja de salida. */
  outboxBatchSize: readPositiveInt('OUTBOX_BATCH_SIZE', 20),

  /** Datos de presentacion del emisor dentro del PDF. */
  issuerName: readText('RECEIPT_ISSUER_NAME', 'Plataforma de Movilidad Urbana'),
  issuerTeam: readText('RECEIPT_ISSUER_TEAM', 'Grupo 14 - Modulo 8'),
  timezone: readText('RECEIPT_TIMEZONE', 'America/Argentina/Buenos_Aires'),
  locale: readText('RECEIPT_LOCALE', 'es-AR'),
} as const;

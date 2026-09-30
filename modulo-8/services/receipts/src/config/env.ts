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

  /** Datos de presentacion del emisor dentro del PDF. */
  issuerName: readText('RECEIPT_ISSUER_NAME', 'Plataforma de Movilidad Urbana'),
  issuerTeam: readText('RECEIPT_ISSUER_TEAM', 'Grupo 14 - Modulo 8'),
  timezone: readText('RECEIPT_TIMEZONE', 'America/Argentina/Buenos_Aires'),
  locale: readText('RECEIPT_LOCALE', 'es-AR'),
} as const;

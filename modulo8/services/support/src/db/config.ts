export interface SupportDbConfig {
  databaseUrl: string;
  // Schema de CommunicationsDB que es propiedad de Support.
  schema: string;
}

export const DEFAULT_SUPPORT_SCHEMA = 'support';
const DEFAULT_RETRY_MS = 5000;

// El nombre del schema se interpola en el SQL (no admite parámetros), por eso
// sólo se acepta un identificador simple en minúsculas.
const SCHEMA_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export function assertSchemaIdentifier(schema: string): string {
  if (!SCHEMA_IDENTIFIER.test(schema)) {
    throw new Error(
      `SUPPORT_DB_SCHEMA debe ser un identificador simple (letras minúsculas, dígitos y "_", hasta 63 caracteres): "${schema}"`,
    );
  }
  return schema;
}

export function loadSupportDbConfig(env: NodeJS.ProcessEnv = process.env): SupportDbConfig {
  const databaseUrl = env.SUPPORT_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'SUPPORT_DATABASE_URL es obligatoria: Support persiste los tickets en CommunicationsDB y no tiene almacenamiento alternativo.',
    );
  }

  return {
    databaseUrl,
    schema: assertSchemaIdentifier(env.SUPPORT_DB_SCHEMA ?? DEFAULT_SUPPORT_SCHEMA),
  };
}

// Espera entre intentos de aplicar las migraciones al arrancar, en milisegundos.
export function loadDatabaseRetryMs(env: NodeJS.ProcessEnv = process.env): number {
  const retryMs = env.SUPPORT_DB_RETRY_MS === undefined ? DEFAULT_RETRY_MS : Number(env.SUPPORT_DB_RETRY_MS);
  if (!Number.isInteger(retryMs) || retryMs < 1) {
    throw new Error(`SUPPORT_DB_RETRY_MS debe ser un entero positivo de milisegundos: "${env.SUPPORT_DB_RETRY_MS}"`);
  }
  return retryMs;
}

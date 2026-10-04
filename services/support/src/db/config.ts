export interface SupportDbConfig {
  databaseUrl: string;
  // Schema de CommunicationsDB que es propiedad de Support.
  schema: string;
}

export const DEFAULT_SUPPORT_SCHEMA = 'support';

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

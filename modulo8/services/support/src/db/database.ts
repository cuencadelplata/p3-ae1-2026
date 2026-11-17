import type { Pool } from 'pg';
import { runMigrations, SCHEMA_SETUP_COMMAND, SupportSchemaMissingError } from './migrations.js';

export interface SupportDatabaseOptions {
  pool: Pool;
  schema: string;
  // Espera entre intentos de preparar el schema.
  retryMs: number;
  migrate?: () => Promise<void>;
}

// Códigos de PostgreSQL que indican que falta el rol, su contraseña no
// coincide o no tiene permisos: lo resuelve el script de init.
const ROLE_OR_PERMISSION_ERRORS = new Set(['28P01', '28000', '42501']);

// Explica por qué no se pudo preparar la base. Si falta el rol o el schema
// incluye el comando que los crea en un volumen que ya existía.
export function describeDatabaseError(error: unknown): string {
  if (error instanceof SupportSchemaMissingError) {
    return error.message;
  }

  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && ROLE_OR_PERMISSION_ERRORS.has(code)) {
    return (
      `PostgreSQL rechazó al rol de Support (${message}). Si el rol o el schema todavía no existen ` +
      `en este volumen, ejecutá: ${SCHEMA_SETUP_COMMAND}`
    );
  }
  return `PostgreSQL no está disponible (${message}).`;
}

// Estado de la base de datos de Support: disponibilidad y migraciones.
export class SupportDatabase {
  private applied = false;
  private stopped = false;
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly retryMs: number;
  private readonly migrate: () => Promise<void>;

  constructor({ pool, schema, retryMs, migrate }: SupportDatabaseOptions) {
    this.pool = pool;
    this.schema = schema;
    this.retryMs = retryMs;
    this.migrate = migrate ?? (() => runMigrations(pool, schema));
  }

  get migrationsApplied(): boolean {
    return this.applied;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  // Aplica las migraciones reintentando hasta lograrlo. El servicio no termina
  // si la base no está disponible al arrancar: sigue atendiendo /health,
  // informa unavailable en /health/ready y se recupera solo cuando vuelve.
  async prepare(): Promise<void> {
    for (let attempt = 1; !this.stopped; attempt += 1) {
      try {
        await this.migrate();
        this.applied = true;
        console.log(
          `[PostgreSQL] Migraciones de Support aplicadas en el schema "${this.schema}"` +
            (attempt > 1 ? ` (intento ${attempt})` : ''),
        );
        return;
      } catch (error) {
        console.error(
          `[PostgreSQL] No se pudieron aplicar las migraciones (intento ${attempt}); ` +
            `se reintenta en ${this.retryMs / 1000}s. ${describeDatabaseError(error)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, this.retryMs));
      }
    }
  }

  stop(): void {
    this.stopped = true;
  }
}

export type DependencyName = 'postgres' | 'redis' | 'rabbitmq';
export type DependencyCheck = () => Promise<boolean>;
export type DependencyChecks = Record<DependencyName, DependencyCheck>;

export interface DependencyStatus {
  status: 'available' | 'unavailable';
  critical: boolean;
}

export interface Readiness {
  status: 'ok' | 'degraded' | 'unavailable';
  dependencies: Record<DependencyName, DependencyStatus>;
}

/**
 * PostgreSQL es la unica dependencia critica: sin ella no se puede emitir ni
 * consultar un comprobante. Sin Redis fallan solo los enlaces temporales, y sin
 * RabbitMQ la API REST sigue funcionando y los eventos esperan en la bandeja de
 * salida; en esos casos el servicio sigue disponible pero degradado.
 */
const CRITICAL: Record<DependencyName, boolean> = { postgres: true, redis: false, rabbitmq: false };

const CHECK_TIMEOUT_MS = 2000;

/** Una verificacion que tarda mas del limite cuenta como no disponible. */
async function probe(check: DependencyCheck): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), CHECK_TIMEOUT_MS);
    timer.unref();
  });
  try {
    return await Promise.race([check().catch(() => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function checkReadiness(checks: DependencyChecks): Promise<Readiness> {
  const names = Object.keys(checks) as DependencyName[];
  const results = await Promise.all(names.map((name) => probe(checks[name])));

  const dependencies = Object.fromEntries(
    names.map((name, index) => [
      name,
      { status: results[index] ? 'available' : 'unavailable', critical: CRITICAL[name] },
    ]),
  ) as Record<DependencyName, DependencyStatus>;

  const down = Object.values(dependencies).filter((dependency) => dependency.status === 'unavailable');
  const status = down.some((dependency) => dependency.critical) ? 'unavailable' : down.length > 0 ? 'degraded' : 'ok';

  return { status, dependencies };
}

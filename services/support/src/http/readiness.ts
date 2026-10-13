export type ReadinessStatus = 'ok' | 'degraded' | 'unavailable';

export interface SupportReadiness {
  status: ReadinessStatus;
  checks: {
    postgres?: { status: 'available' | 'unavailable'; critical: true };
    migrations?: { status: 'applied' | 'pending'; critical: true };
    rabbitmq?: { status: 'available' | 'unavailable'; critical: false };
    trips?: { status: 'available' | 'unavailable'; critical: false };
    identity?: { status: 'available' | 'unavailable'; critical: false };
  };
}

export interface ReadinessProbes {
  // Base de datos de Support. Es crítica: sin ella no hay tickets.
  database?: {
    isAvailable(): Promise<boolean>;
    readonly migrationsApplied: boolean;
  };
  // Broker heredado de AE1; sólo se informa con SUPPORT_LEGACY_EVENTS=on. No
  // es crítico: la API de tickets funciona sin él.
  legacyBroker?: () => boolean;
  // Servicio de viajes de M6; sólo se informa si la verificación está
  // habilitada. No es crítico: consultar y actualizar tickets funciona sin él.
  trips?: () => Promise<boolean>;
  // Servicio de identidad de M1; sólo se informa si la autenticación está
  // habilitada. No es crítico para el health: M8 sigue vivo sin él.
  identity?: () => Promise<boolean>;
}

// Estado de Support para el health común de M8:
// - unavailable: la base no responde o faltan las migraciones;
// - degraded: la base está bien pero el broker heredado, M6 o M1 no;
// - ok: todo lo requerido está operativo.
export async function checkSupportReadiness({ database, legacyBroker, trips, identity }: ReadinessProbes): Promise<SupportReadiness> {
  const checks: SupportReadiness['checks'] = {};

  if (database) {
    checks.postgres = { status: (await database.isAvailable()) ? 'available' : 'unavailable', critical: true };
    checks.migrations = { status: database.migrationsApplied ? 'applied' : 'pending', critical: true };
  }
  if (legacyBroker) {
    checks.rabbitmq = { status: legacyBroker() ? 'available' : 'unavailable', critical: false };
  }
  if (trips) {
    checks.trips = { status: (await trips()) ? 'available' : 'unavailable', critical: false };
  }
  if (identity) {
    checks.identity = { status: (await identity()) ? 'available' : 'unavailable', critical: false };
  }

  if (checks.postgres?.status === 'unavailable' || checks.migrations?.status === 'pending') {
    return { status: 'unavailable', checks };
  }
  if (
    checks.rabbitmq?.status === 'unavailable' ||
    checks.trips?.status === 'unavailable' ||
    checks.identity?.status === 'unavailable'
  ) {
    return { status: 'degraded', checks };
  }
  return { status: 'ok', checks };
}

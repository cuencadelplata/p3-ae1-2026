import {
  markCollectorFailure,
  setDatabaseState,
  setDependencyState,
  setObservedStateMaxAge,
  setQueueState,
  type DatabaseStateSnapshot,
  type QueueStateSnapshot,
} from './metrics.js';

export type DatabaseStateQuery = () => Promise<Omit<DatabaseStateSnapshot, 'collectedAtMs'>>;
export type QueueStateQuery = () => Promise<QueueStateSnapshot['queues']>;
export interface DependencyCheck {
  name: string;
  check: () => Promise<boolean>;
}

export interface StateCollectorOptions {
  intervalMs: number;
  database?: DatabaseStateQuery;
  queues?: QueueStateQuery;
  dependencies?: DependencyCheck[];
  onError?: (source: string, error: unknown) => void;
}

/**
 * Recolector periódico de estado (backlog Outbox, reservas vencidas/estancadas, profundidad
 * de colas y salud de dependencias). Usa consultas AGREGADAS (COUNT/MIN) sobre índices
 * existentes: nunca carga filas completas. Si una consulta falla, la señal queda ausente
 * (no se reporta un falso cero) y `m9.state_collector.up{source}` pasa a 0.
 */
export class StateMetricsCollector {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  public constructor(private readonly options: StateCollectorOptions) {
    // Las muestras vencen tras 3 intervalos sin recolección exitosa.
    setObservedStateMaxAge(options.intervalMs * 3);
  }

  public start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.collect(), this.options.intervalMs);
    this.timer.unref();
    void this.collect();
  }

  public stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  public async collect(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await Promise.all([this.collectDatabase(), this.collectQueues(), this.collectDependencies()]);
    } finally {
      this.running = false;
    }
  }

  private async collectDatabase(): Promise<void> {
    if (this.options.database === undefined) return;
    try {
      const snapshot = await this.options.database();
      setDatabaseState({ ...snapshot, collectedAtMs: Date.now() });
    } catch (error) {
      markCollectorFailure('database');
      this.options.onError?.('database', error);
    }
  }

  private async collectQueues(): Promise<void> {
    if (this.options.queues === undefined) return;
    try {
      const queues = await this.options.queues();
      setQueueState({ queues, collectedAtMs: Date.now() });
    } catch (error) {
      markCollectorFailure('rabbitmq');
      this.options.onError?.('rabbitmq', error);
    }
  }

  private async collectDependencies(): Promise<void> {
    const checks = this.options.dependencies;
    if (checks === undefined || checks.length === 0) return;
    try {
      const results = await Promise.all(
        checks.map(async ({ name, check }) => [name, await check().catch(() => false)] as const),
      );
      setDependencyState({ dependencies: Object.fromEntries(results), collectedAtMs: Date.now() });
    } catch (error) {
      markCollectorFailure('dependencies');
      this.options.onError?.('dependencies', error);
    }
  }
}

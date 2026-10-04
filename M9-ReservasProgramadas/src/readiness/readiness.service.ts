export interface DependencyProbe {
  name: string;
  check(): Promise<boolean>;
}

export interface ReadinessResult {
  status: 'ready' | 'degraded';
  dependencies: Record<string, 'up' | 'down'>;
}

export class ReadinessService {
  public constructor(private readonly probes: DependencyProbe[]) {}

  public async check(): Promise<ReadinessResult> {
    const results = await Promise.all(
      this.probes.map(async (probe) => {
        try {
          return [probe.name, (await probe.check()) ? 'up' : 'down'] as const;
        } catch {
          return [probe.name, 'down'] as const;
        }
      }),
    );
    const dependencies = Object.fromEntries(results);
    return {
      status: results.every(([, status]) => status === 'up') ? 'ready' : 'degraded',
      dependencies,
    };
  }
}

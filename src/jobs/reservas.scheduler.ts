import cron from 'node-cron';

import type { ReservaRepository } from '../repositories/reserva.repository.js';
import type { ActivacionReservaService } from '../services/activacion-reserva.service.js';

export interface ResultadoEjecucionScheduler {
  encontradas: number;
  activadas: number;
  fallidas: number;
}

export class ReservasScheduler {
  private task: ReturnType<typeof cron.schedule> | null = null;

  public constructor(
    private readonly repository: ReservaRepository,
    private readonly activacionService: ActivacionReservaService,
    private readonly expresionCron: string,
    private readonly onError: (error: unknown) => void = console.error,
  ) {}

  public start(): void {
    if (!cron.validate(this.expresionCron)) {
      throw new Error('RESERVATION_JOB_INTERVAL no es una expresión cron válida.');
    }
    if (this.task !== null) return;

    this.task = cron.schedule(this.expresionCron, () => {
      void this.ejecutar().catch(this.onError);
    });
  }

  public stop(): void {
    this.task?.stop();
    this.task = null;
  }

  public async ejecutar(fechaLimite = new Date()): Promise<ResultadoEjecucionScheduler> {
    const pendientes = await this.repository.buscarPendientes(fechaLimite);
    const resultados = await Promise.allSettled(
      pendientes.map(({ id }) => this.activacionService.activar(id)),
    );
    const activadas = resultados.filter(
      (result) => result.status === 'fulfilled' && result.value.activada,
    ).length;

    return {
      encontradas: pendientes.length,
      activadas,
      fallidas: resultados.length - activadas,
    };
  }
}

import { randomUUID } from 'node:crypto';

import cron from 'node-cron';

import { runWithRequestContext } from '../integration/request-context.js';
import { markSchedulerSuccess, now, recordSchedulerRun } from '../observability/metrics.js';
import { withSpan } from '../observability/tracing.js';
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

  /**
   * Trabajo diferido: cada ejecución inicia una traza NUEVA (`scheduler.run`); no se mantiene
   * abierto ningún span desde la creación de la reserva hasta su fecha programada.
   */
  public async ejecutar(fechaLimite = new Date()): Promise<ResultadoEjecucionScheduler> {
    return withSpan(
      'scheduler.run',
      async (span) => {
        const startMs = now();
        try {
          const resultado = await this.ejecutarLote(fechaLimite);
          span.setAttributes({
            'm9.scheduler.found': resultado.encontradas,
            'm9.scheduler.failed': resultado.fallidas,
          });
          recordSchedulerRun('success', startMs, resultado.encontradas);
          markSchedulerSuccess();
          return resultado;
        } catch (error) {
          recordSchedulerRun('error', startMs, 0);
          throw error;
        }
      },
      { root: true },
    );
  }

  private async ejecutarLote(fechaLimite: Date): Promise<ResultadoEjecucionScheduler> {
    const pendientes = await this.repository.buscarPendientes(fechaLimite);
    const resultados = await Promise.allSettled(
      pendientes.map(({ id }) => {
        const correlationId = randomUUID();
        return runWithRequestContext({ correlationId }, () =>
          withSpan('reservation.activate', () => this.activacionService.activar(id), {
            attributes: { 'm9.reservation_id': id, 'm9.correlation_id': correlationId },
          }),
        );
      }),
    );
    // Un fallo de una activación (M5 caído, 401, timeout) no corta el lote, pero debe quedar
    // registrado: la reserva vuelve a PROGRAMADA y se reintenta en la próxima ejecución.
    for (const result of resultados) {
      if (result.status === 'rejected') this.onError(result.reason);
    }
    const activadas = resultados.filter(
      (result) => result.status === 'fulfilled' && result.value.activada,
    ).length;
    const fallidas = resultados.filter(
      (result) =>
        result.status === 'rejected' || (result.status === 'fulfilled' && result.value.fallida),
    ).length;

    return {
      encontradas: pendientes.length,
      activadas,
      fallidas,
    };
  }
}

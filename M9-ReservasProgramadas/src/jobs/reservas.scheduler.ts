import { randomUUID } from 'node:crypto';

import cron from 'node-cron';

import { runWithRequestContext } from '../integration/request-context.js';
import { markSchedulerSuccess, now, recordSchedulerRun } from '../observability/metrics.js';
import { withSpan } from '../observability/tracing.js';
import type { ReservaRepository } from '../repositories/reserva.repository.js';
import type {
  ActivacionReservaService,
  ResultadoActivacion,
} from '../services/activacion-reserva.service.js';

export interface ResultadoEjecucionScheduler {
  encontradas: number;
  activadas: number;
  fallidas: number;
}

export class ReservasScheduler {
  private inFlight: Promise<ResultadoEjecucionScheduler> | null = null;
  private task: ReturnType<typeof cron.schedule> | null = null;

  public constructor(
    private readonly repository: ReservaRepository,
    private readonly activacionService: ActivacionReservaService,
    private readonly expresionCron: string,
    private readonly onError: (error: unknown) => void = console.error,
    private readonly concurrency = 2,
    private readonly demoClientId?: string,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
      throw new Error('SCHEDULER_CONCURRENCY debe estar entre 1 y 16.');
  }

  public start(): void {
    if (!cron.validate(this.expresionCron)) {
      throw new Error('RESERVATION_JOB_INTERVAL no es una expresión cron válida.');
    }
    if (this.task !== null) return;

    this.task = cron.schedule(this.expresionCron, () => {
      if (this.inFlight === null) void this.ejecutar().catch(this.onError);
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
  public ejecutar(fechaLimite = new Date()): Promise<ResultadoEjecucionScheduler> {
    if (this.inFlight !== null) return this.inFlight;
    this.inFlight = this.ejecutarMedido(fechaLimite).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async ejecutarMedido(fechaLimite: Date): Promise<ResultadoEjecucionScheduler> {
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
    const pendientes = await this.repository.buscarPendientes(fechaLimite, 100, this.demoClientId);
    const resultados: Array<PromiseSettledResult<ResultadoActivacion>> = [];
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(this.concurrency, pendientes.length) }, async () => {
        while (cursor < pendientes.length) {
          const reserva = pendientes[cursor++];
          if (!reserva) return;
          const correlationId = randomUUID();
          try {
            const value = await runWithRequestContext({ correlationId }, () =>
              withSpan('reservation.activate', () => this.activacionService.activar(reserva.id), {
                attributes: { 'm9.reservation_id': reserva.id, 'm9.correlation_id': correlationId },
              }),
            );
            resultados.push({ status: 'fulfilled', value });
          } catch (reason) {
            resultados.push({ status: 'rejected', reason });
          }
        }
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

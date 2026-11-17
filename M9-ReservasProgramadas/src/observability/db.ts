import { now, recordDbOperation } from './metrics.js';
import { withSpan } from './tracing.js';

/**
 * Mide una operación de repositorio (incluye transacciones completas). El nombre es una
 * operación lógica acotada (`reservation.create`, `outbox.find_pending`, ...), nunca el
 * texto SQL. Los spans detallados de consultas los agrega `@prisma/instrumentation`.
 */
export const measureDb = <T>(operation: string, action: () => Promise<T>): Promise<T> =>
  withSpan(
    `db ${operation}`,
    async () => {
      const startMs = now();
      try {
        const result = await action();
        recordDbOperation(operation, 'ok', startMs);
        return result;
      } catch (error) {
        recordDbOperation(operation, 'error', startMs);
        throw error;
      }
    },
    { attributes: { 'db.system.name': 'postgresql', 'm9.db.operation': operation } },
  );

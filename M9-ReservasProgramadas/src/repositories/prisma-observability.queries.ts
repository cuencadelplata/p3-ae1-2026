import type { PrismaClient } from '@prisma/client';

import type { DatabaseStateQuery } from '../observability/state-collector.js';

const ageSeconds = (date: Date | null | undefined, nowMs: number): number =>
  date === null || date === undefined ? 0 : Math.max(0, (nowMs - date.getTime()) / 1000);

/**
 * Consultas agregadas para el recolector de estado. Cada una es COUNT/MIN filtrado por
 * `status` (índices `reservations_status_scheduled_at_idx` y `outbox_status_next_attempt_idx`);
 * el costo no depende del tamaño de las filas y no se transfieren datos personales.
 */
export const createDatabaseStateQuery =
  (prisma: PrismaClient, stuckThresholdSeconds: number): DatabaseStateQuery =>
  async () => {
    const nowDate = new Date();
    const nowMs = nowDate.getTime();
    const stuckBefore = new Date(nowMs - stuckThresholdSeconds * 1000);

    const [byStatus, overdue, activating, stuck, outboxPending, outboxFailed] = await Promise.all([
      prisma.reservation.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.reservation.aggregate({
        where: { status: 'PROGRAMADA', scheduledAt: { lte: nowDate } },
        _count: { _all: true },
        _min: { scheduledAt: true },
      }),
      prisma.reservation.aggregate({
        where: { status: 'ACTIVANDO' },
        _min: { updatedAt: true },
      }),
      prisma.reservation.count({
        where: { status: 'ACTIVANDO', updatedAt: { lte: stuckBefore } },
      }),
      prisma.outboxEvent.aggregate({
        where: { status: 'PENDING' },
        _count: { _all: true },
        _min: { createdAt: true },
      }),
      prisma.outboxEvent.count({ where: { status: 'FAILED' } }),
    ]);

    const reservationsByStatus: Record<string, number> = {
      PROGRAMADA: 0,
      ACTIVANDO: 0,
      ACTIVADA: 0,
      CANCELADA: 0,
      FALLIDA: 0,
    };
    for (const row of byStatus) reservationsByStatus[row.status] = row._count._all;

    return {
      reservationsByStatus,
      overduePending: overdue._count._all,
      oldestOverdueSeconds: ageSeconds(overdue._min.scheduledAt, nowMs),
      stuckActivating: stuck,
      oldestActivatingSeconds: ageSeconds(activating._min.updatedAt, nowMs),
      outboxPending: outboxPending._count._all,
      outboxOldestPendingSeconds: ageSeconds(outboxPending._min.createdAt, nowMs),
      outboxFailed,
    };
  };

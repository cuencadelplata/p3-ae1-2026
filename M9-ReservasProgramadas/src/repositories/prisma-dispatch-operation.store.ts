import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import type { DispatchOperationStore } from '../clients/m5-dispatch.client.js';

export class PrismaDispatchOperationStore implements DispatchOperationStore {
  public constructor(private readonly prisma: PrismaClient) {}

  public async getOrCreate(reservaId: string): Promise<string> {
    const current = await this.prisma.reservation.findUnique({
      where: { id: reservaId },
      select: { dispatchIdempotencyKey: true },
    });
    if (current?.dispatchIdempotencyKey !== null && current?.dispatchIdempotencyKey !== undefined) {
      return current.dispatchIdempotencyKey;
    }

    const key = randomUUID();
    const claimed = await this.prisma.reservation.updateMany({
      where: { id: reservaId, dispatchIdempotencyKey: null },
      data: { dispatchIdempotencyKey: key },
    });
    if (claimed.count === 1) return key;

    const winner = await this.prisma.reservation.findUniqueOrThrow({
      where: { id: reservaId },
      select: { dispatchIdempotencyKey: true },
    });
    if (winner.dispatchIdempotencyKey === null) {
      throw new Error('No se pudo persistir la Idempotency-Key de despacho.');
    }
    return winner.dispatchIdempotencyKey;
  }
}

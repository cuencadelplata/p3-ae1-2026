import type { RequestHandler } from 'express';
import { PrismaClient } from '@prisma/client';

import { env } from '../config/env.js';

const prisma = new PrismaClient();

const checkUrl = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
};

export interface HealthProbes {
  database: () => Promise<unknown>;
  m5: () => Promise<boolean>;
  m7: () => Promise<boolean>;
}

const probeStatus = async (probe: () => Promise<unknown>): Promise<'ok' | 'down'> => {
  try {
    return (await probe()) === false ? 'down' : 'ok';
  } catch {
    return 'down';
  }
};

export const createHealthController =
  (probes: HealthProbes): RequestHandler =>
  async (_request, response) => {
    const [dbStatus, m5Status, m7Status] = await Promise.all([
      probeStatus(probes.database),
      probeStatus(probes.m5),
      probeStatus(probes.m7),
    ]);
    const overallStatus =
      dbStatus === 'ok' && m5Status === 'ok' && m7Status === 'ok' ? 'ok' : 'degraded';

    response.status(overallStatus === 'ok' ? 200 : 503).json({
      service: 'm9-reservas-programadas',
      status: overallStatus,
      dependencies: {
        database: dbStatus,
        m5: m5Status,
        m7: m7Status,
      },
    });
  };

export const getHealth = createHealthController({
  database: () => prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`,
  m5: () => checkUrl(`${env.M5_URL}/health`),
  m7: () => checkUrl(`${env.M7_URL}/health`),
});

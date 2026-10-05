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

export const getHealth: RequestHandler = async (_request, response) => {
  const dbStatus = await prisma
    .$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`
    .then(() => 'ok')
    .catch(() => 'down');

  const m5Status = await checkUrl(`${env.M5_URL}/health`)
    .then((ok) => (ok ? 'ok' : 'down'))
    .catch(() => 'down');

  const m7Status = await checkUrl(`${env.M7_URL}/health`)
    .then((ok) => (ok ? 'ok' : 'down'))
    .catch(() => 'down');

  const overallStatus = dbStatus === 'ok' && m5Status === 'ok' && m7Status === 'ok' ? 'ok' : 'degraded';

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

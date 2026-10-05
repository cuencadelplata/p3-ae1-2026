import { Router, Request, Response } from 'express';
import { withChaos } from './chaos.js';

/**
 * Stub del módulo de Soporte (penalizaciones).
 * Contrato:
 *   GET /usuarios/:userId/penalizaciones
 *   X-Secret-Key: <key>  → obligatorio, clave inválida o ausente → 401
 *   200 { userId, total, penalizaciones: [...] }
 *
 * Datos fijos:
 *   userId 12 → sin penalizaciones
 *   userId 13 → 1 penalización vigente
 *   userId 14 → 3 penalizaciones vigentes
 *   userId 15 → 5 penalizaciones vigentes
 *   cualquier otro → sin penalizaciones
 */

type Penalizacion = {
  ticketId: string;
  tripId: string;
  motivo: string;
  fecha: string;
};

const DB: Record<number, Penalizacion[]> = {
  12: [],
  13: [
    {
      ticketId: 'tick_001',
      tripId: 'trip_aaa1',
      motivo: 'Cancelación tardía',
      fecha: '2026-09-01T10:00:00Z'
    }
  ],
  14: [
    {
      ticketId: 'tick_002',
      tripId: 'trip_aaa2',
      motivo: 'Cancelación tardía',
      fecha: '2026-09-05T12:00:00Z'
    },
    {
      ticketId: 'tick_003',
      tripId: 'trip_aaa3',
      motivo: 'No presentarse',
      fecha: '2026-09-10T14:00:00Z'
    },
    {
      ticketId: 'tick_004',
      tripId: 'trip_aaa4',
      motivo: 'Conducta inapropiada',
      fecha: '2026-09-15T16:00:00Z'
    }
  ],
  15: [
    {
      ticketId: 'tick_005',
      tripId: 'trip_bbb1',
      motivo: 'Cancelación tardía',
      fecha: '2026-09-01T08:00:00Z'
    },
    {
      ticketId: 'tick_006',
      tripId: 'trip_bbb2',
      motivo: 'No presentarse',
      fecha: '2026-09-02T08:00:00Z'
    },
    {
      ticketId: 'tick_007',
      tripId: 'trip_bbb3',
      motivo: 'Conducta inapropiada',
      fecha: '2026-09-03T08:00:00Z'
    },
    {
      ticketId: 'tick_008',
      tripId: 'trip_bbb4',
      motivo: 'Cancelación tardía',
      fecha: '2026-09-04T08:00:00Z'
    },
    {
      ticketId: 'tick_009',
      tripId: 'trip_bbb5',
      motivo: 'No presentarse',
      fecha: '2026-09-05T08:00:00Z'
    }
  ]
};

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'UP', service: 'soporte-stub' });
});

router.get('/usuarios/:userId/penalizaciones', (req: Request, res: Response) => {
  // Autenticación por secretKey (X-Secret-Key header)
  const secretKey = process.env.SOPORTE_SECRET_KEY ?? 'secret-m2';
  if (req.headers['x-secret-key'] !== secretKey) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'X-Secret-Key inválida o ausente'
    });
    return;
  }

  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) {
    res.status(400).json({
      error: 'BadRequest',
      message: 'userId debe ser un número entero'
    });
    return;
  }

  const penalizaciones = DB[userId] ?? [];
  res.json({
    userId,
    total: penalizaciones.length,
    penalizaciones
  });
});

export const soporteStub = withChaos('soporte', router);

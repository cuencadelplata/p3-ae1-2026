import { Router, Request, Response } from 'express';

/**
 * Stub del módulo M6 (Viajes).
 * Reemplaza la carpeta stub-m6/ que usaba un servidor HTTP independiente.
 * Contrato:
 *   GET /v1/trips?userId=<id>
 *   Authorization: Bearer <token>  → obligatorio, sin token → 401
 *   200 { userId, tripsCount, trips: [...] }
 *
 * Datos fijos (sin aleatoriedad para que los tests sean determinísticos):
 *   userId 12 → 2 viajes completados (escenario "perfil habilitado")
 *   userId 13 → 1 viaje completado
 *   userId 14 → 3 viajes, uno cancelado (escenario "perfil inhabilitado")
 *   cualquier otro → sin viajes
 */

type Trip = {
  tripId: string;
  origin: string;
  destination: string;
  fare: number;
  status: string;
  createdAt: string;
};

const DB: Record<number, Trip[]> = {
  12: [
    {
      tripId: 'trip_99217c2f',
      origin: 'Av. Colón 1200, Córdoba',
      destination: 'Av. General Paz 250, Córdoba',
      fare: 1850.0,
      status: 'COMPLETADO',
      createdAt: '2026-08-29T14:20:00Z'
    },
    {
      tripId: 'trip_88201a4e',
      origin: 'Plaza España, Córdoba',
      destination: 'Aeropuerto Córdoba',
      fare: 5200.0,
      status: 'COMPLETADO',
      createdAt: '2026-08-28T09:15:00Z'
    }
  ],
  13: [
    {
      tripId: 'trip_77101b3d',
      origin: 'Patio Olmos, Córdoba',
      destination: 'Ciudad Universitaria, Córdoba',
      fare: 1450.0,
      status: 'COMPLETADO',
      createdAt: '2026-09-01T11:00:00Z'
    }
  ],
  14: [
    {
      tripId: 'trip_aaa2',
      origin: 'Nueva Córdoba',
      destination: 'Cerro de las Rosas, Córdoba',
      fare: 2300.0,
      status: 'COMPLETADO',
      createdAt: '2026-09-05T12:00:00Z'
    },
    {
      tripId: 'trip_aaa3',
      origin: 'Shopping Dinosaurio, Córdoba',
      destination: 'Barrio Jardín, Córdoba',
      fare: 1980.0,
      status: 'CANCELADO',
      createdAt: '2026-09-10T14:00:00Z'
    },
    {
      tripId: 'trip_aaa4',
      origin: 'Terminal de Ómnibus, Córdoba',
      destination: 'Villa Allende',
      fare: 4100.0,
      status: 'COMPLETADO',
      createdAt: '2026-09-15T16:00:00Z'
    }
  ]
};

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'UP', service: 'm6-stub-viajes' });
});

router.get('/v1/trips', (req: Request, res: Response) => {
  // El token es obligatorio
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Token requerido'
    });
    return;
  }

  const { userId } = req.query;
  if (!userId) {
    res.status(400).json({
      error: 'BadRequest',
      message: 'El parámetro userId es obligatorio'
    });
    return;
  }

  const userIdNum = parseInt(String(userId), 10);
  if (isNaN(userIdNum)) {
    res.status(400).json({
      error: 'BadRequest',
      message: 'userId debe ser un número entero'
    });
    return;
  }

  const trips = DB[userIdNum] ?? [];
  res.json({
    userId: userIdNum,
    tripsCount: trips.length,
    trips
  });
});

// Se exporta el router crudo; withChaos se aplica en mountStubs (ver src/stubs/index.ts)
export const m6StubRouter = router;

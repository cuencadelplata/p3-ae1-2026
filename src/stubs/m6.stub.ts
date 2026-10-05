import { Router, Request, Response } from 'express';

/**
 * Stub del módulo M6 (Viajes).
 * Reemplaza la carpeta stub-m6/ que usaba un servidor HTTP independiente.
 * Contrato (igual que M6 real):
 *   GET /api/clientes/<clienteId>/viajes   (sin autenticación)
 *   200 { clienteId, viajes: [{ id, estado, origen, destino, fechaCreacion, finalizacion, historialTransiciones }] }
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

/**
 * Mismo contrato que M6 real (m6_viajes/openapi.yaml, obtenerViajesDeCliente):
 * GET /api/clientes/{clienteId}/viajes → { clienteId, viajes: [...] }.
 * Sin autenticación (M6 lo expone a consumidores de confianza). Cliente sin viajes → lista vacía.
 */
router.get('/api/clientes/:clienteId/viajes', (req: Request, res: Response) => {
  const { clienteId } = req.params;
  const trips = DB[Number.parseInt(clienteId, 10)] ?? [];
  res.json({
    clienteId,
    viajes: trips.map((trip) => ({
      id: trip.tripId,
      clienteId,
      conductorId: 'conductor-001',
      estado: trip.status,
      origen: trip.origin,
      destino: trip.destination,
      fechaCreacion: trip.createdAt,
      // M6 solo informa la finalización (y el total cobrado) de los viajes completados
      finalizacion: trip.status === 'COMPLETADO'
        ? {
            tiempoMinutos: 18,
            distanciaKm: 6.4,
            horaFin: trip.createdAt,
            metodoPago: 'efectivo',
            total: trip.fare,
            tipoVehiculo: 'auto',
            fuenteMetrica: 'M4',
            metricasEstimadas: true,
            paymentId: `pay_${trip.tripId}`
          }
        : null,
      historialTransiciones: []
    }))
  });
});

// Se exporta el router crudo; withChaos se aplica en mountStubs (ver src/stubs/index.ts)
export const m6StubRouter = router;

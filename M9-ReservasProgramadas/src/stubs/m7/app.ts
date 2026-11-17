import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { createHttpTelemetryMiddleware } from '../../observability/http-telemetry.js';

// Rutas propias del stub M7 (identificado como servicio `m7-stub` en la telemetría).
const m7Routes = (url: string, statusCode: number) => {
  const path = url.split('?')[0];
  if (path === '/tarifa/estimacion') return { route: path, kind: 'business' as const };
  if (path === '/health') return { route: path, kind: 'health' as const };
  return statusCode === 404
    ? { route: 'unmatched', kind: 'unmatched' as const }
    : { route: '/static', kind: 'static' as const };
};

const geoSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  direccion: z.string().min(1),
});
const estimationSchema = z
  .object({
    origen: geoSchema,
    destino: geoSchema,
    distanciaKm: z.number().nonnegative(),
    tiempoEstimadoMin: z.number().nonnegative(),
    vehicleType: z.enum(['auto', 'moto']),
  })
  .strict();

export const createM7StubApp = () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(createHttpTelemetryMiddleware(m7Routes));
  app.use(express.json());
  app.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }));
  app.post('/tarifa/estimacion', (request, response) => {
    const parsed = estimationSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Datos inválidos para estimar la tarifa.' });
      return;
    }
    const { distanciaKm, tiempoEstimadoMin, vehicleType } = parsed.data;
    const tarifaBase = 500;
    const costoDistancia = distanciaKm * 250;
    const costoTiempo = tiempoEstimadoMin * 50;
    const multiplicadorVehiculo = vehicleType === 'moto' ? 0.8 : 1;
    response.status(200).json({
      estimacionId: `est_${randomUUID()}`,
      distanciaKm,
      tiempoEstimadoMin,
      vehicleType,
      estimatedFare: (tarifaBase + costoDistancia + costoTiempo) * multiplicadorVehiculo,
      currency: 'ARS',
      desglose: { tarifaBase, costoDistancia, costoTiempo, multiplicadorVehiculo },
      calculadoEn: new Date().toISOString(),
    });
  });
  return app;
};

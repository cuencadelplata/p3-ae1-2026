import { randomUUID } from 'node:crypto';

import express from 'express';
import { z } from 'zod';

import { asignacionSchema } from '../../clients/asignacion.client.js';
import type { AsignacionChofer, TipoVehiculo } from '../../domain/reserva.js';

export interface ChoferStub {
  id: string;
  nombre: string;
  valoracion: number;
  vehiculo: TipoVehiculo;
}

export const CHOFERES_DEMO: ChoferStub[] = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    nombre: 'Chofer Auto A (demo)',
    valoracion: 4.9,
    vehiculo: 'AUTO',
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    nombre: 'Chofer Auto B (demo)',
    valoracion: 4.7,
    vehiculo: 'AUTO',
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    nombre: 'Chofer Moto A (demo)',
    valoracion: 4.8,
    vehiculo: 'MOTO',
  },
];

const reservaSchema = z.object({
  id: z.string().uuid(),
  origen: z.string().min(1),
  destino: z.string().min(1),
  vehiculo: z.enum(['AUTO', 'MOTO']),
  fechaHoraProgramada: z.string().datetime({ offset: true }),
});
type DatosReserva = z.infer<typeof reservaSchema>;
interface Ocupacion {
  reserva: DatosReserva;
  asignacion: AsignacionChofer;
}
const mismoViaje = (a: DatosReserva, b: DatosReserva): boolean =>
  a.origen === b.origen &&
  a.destino === b.destino &&
  a.vehiculo === b.vehiculo &&
  Date.parse(a.fechaHoraProgramada) === Date.parse(b.fechaHoraProgramada);

export const createM5StubApp = (choferes: readonly ChoferStub[] = CHOFERES_DEMO) => {
  const app = express();
  const ocupaciones = new Map<string, Ocupacion>();
  const solicitudes = new Map<string, { solicitudId: string; estado: string }>();
  app.disable('x-powered-by');
  app.use(express.json());
  app.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }));
  app.put('/asignaciones/:id', (request, response) => {
    const parsed = reservaSchema.safeParse(request.body?.reserva);
    if (!parsed.success || parsed.data.id !== request.params.id) {
      response.status(400).json({ error: 'Reserva inválida.' });
      return;
    }
    const reserva = parsed.data;
    if (solicitudes.has(reserva.id)) {
      response.status(409).json({ error: 'El despacho ya fue activado.' });
      return;
    }
    // Simulación: cada viaje ocupa una hora desde su inicio; no estima duración real.
    const inicio = Date.parse(reserva.fechaHoraProgramada);
    const candidatos = choferes
      .filter(
        (chofer) =>
          chofer.vehiculo === reserva.vehiculo &&
          ![...ocupaciones.entries()].some(
            ([id, ocupacion]) =>
              id !== reserva.id &&
              ocupacion.asignacion.choferId === chofer.id &&
              Math.abs(Date.parse(ocupacion.reserva.fechaHoraProgramada) - inicio) < 3_600_000,
          ),
      )
      .sort((a, b) => b.valoracion - a.valoracion || a.id.localeCompare(b.id));
    const chofer = candidatos[0];
    if (chofer === undefined) {
      ocupaciones.delete(reserva.id);
      response.json({ asignacion: null });
      return;
    }
    const anterior = ocupaciones.get(reserva.id);
    const asignacion: AsignacionChofer = {
      id: anterior?.asignacion.choferId === chofer.id ? anterior.asignacion.id : randomUUID(),
      choferId: chofer.id,
      nombreChofer: chofer.nombre,
      valoracion: chofer.valoracion,
    };
    ocupaciones.set(reserva.id, { reserva, asignacion });
    response.json({ asignacion });
  });
  app.delete('/asignaciones/:id', (request, response) => {
    if (solicitudes.has(request.params.id)) {
      response.status(409).json({ error: 'El despacho ya fue activado.' });
      return;
    }
    ocupaciones.delete(request.params.id);
    response.sendStatus(204);
  });
  app.post('/solicitudes', (request, response) => {
    const parsed = reservaSchema
      .extend({ asignacion: asignacionSchema })
      .safeParse(request.body?.reserva);
    if (!parsed.success) {
      response.status(400).json({ error: 'Se requiere una reserva con asignación.' });
      return;
    }
    const reserva = parsed.data;
    const ocupacion = ocupaciones.get(reserva.id);
    if (
      ocupacion === undefined ||
      ocupacion.asignacion.id !== reserva.asignacion.id ||
      ocupacion.asignacion.choferId !== reserva.asignacion.choferId ||
      !mismoViaje(ocupacion.reserva, reserva)
    ) {
      response.status(409).json({ error: 'La asignación no está vigente para este viaje.' });
      return;
    }
    let solicitud = solicitudes.get(reserva.id);
    if (solicitud === undefined) {
      solicitud = { solicitudId: randomUUID(), estado: 'CREADA' };
      solicitudes.set(reserva.id, solicitud);
    }
    response.status(201).json(solicitud);
  });
  return app;
};

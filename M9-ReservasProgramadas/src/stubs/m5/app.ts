import { randomUUID } from 'node:crypto';

import express from 'express';
import { z } from 'zod';

import { asignacionSchema } from '../../clients/asignacion.client.js';
import type { AsignacionChofer, TipoVehiculo } from '../../domain/reserva.js';
import { Ofertas, type RespuestaSimulada } from './ofertas.js';

export interface ChoferStub {
  id: string;
  nombre: string;
  valoracion: number;
  vehiculo: TipoVehiculo;
  respuestaSimulada?: RespuestaSimulada;
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
  criterioAsignacion: z.literal('MEJOR_CALIFICACION'),
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

export const createM5StubApp = (
  choferes: readonly ChoferStub[] = CHOFERES_DEMO,
  opciones: { plazoOfertaMs?: number; demoraRespuestaMs?: number } = {},
) => {
  const plazo = opciones.plazoOfertaMs ?? 200;
  const demora = opciones.demoraRespuestaMs ?? 10;
  if (!Number.isFinite(plazo) || plazo <= 0 || !Number.isFinite(demora) || demora < 0)
    throw new Error('Los tiempos de oferta deben ser válidos.');
  const app = express();
  const ofertas = new Ofertas();
  const ocupaciones = new Map<string, Ocupacion>();
  const rondas = new Map<
    string,
    { id: string; reserva: DatosReserva; resultado: Promise<AsignacionChofer | null> }
  >();
  const enOferta = new Map<string, { choferId: string; reserva: DatosReserva }>();
  const solicitudes = new Map<string, { solicitudId: string; estado: string }>();
  const solapa = (a: DatosReserva, b: DatosReserva) =>
    Math.abs(Date.parse(a.fechaHoraProgramada) - Date.parse(b.fechaHoraProgramada)) < 3_600_000;
  const invalidar = (id: string) => {
    const ronda = rondas.get(id);
    rondas.delete(id);
    ocupaciones.delete(id);
    if (ronda) {
      ofertas.cancelarRonda(ronda.id);
      enOferta.delete(ronda.id);
    }
  };
  const buscar = async (
    reserva: DatosReserva,
    rondaId: string,
  ): Promise<AsignacionChofer | null> => {
    const candidatos = choferes
      .filter((c) => c.vehiculo === reserva.vehiculo)
      .sort((a, b) => b.valoracion - a.valoracion || a.id.localeCompare(b.id));
    for (const chofer of candidatos) {
      if (rondas.get(reserva.id)?.id !== rondaId) return null;
      if (
        [...enOferta.values()].some(
          (o) => o.choferId === chofer.id && solapa(o.reserva, reserva),
        ) ||
        [...ocupaciones.values()].some(
          (o) => o.asignacion.choferId === chofer.id && solapa(o.reserva, reserva),
        )
      )
        continue;
      // La toma del candidato no contiene await: evita ofertas simultáneas solapadas.
      enOferta.set(rondaId, { choferId: chofer.id, reserva });
      const oferta = await ofertas.abrir(
        reserva.id,
        rondaId,
        chofer.id,
        chofer.respuestaSimulada ?? 'ACEPTAR',
        plazo,
        demora,
      );
      enOferta.delete(rondaId);
      if (rondas.get(reserva.id)?.id !== rondaId) return null;
      if (oferta.estado !== 'ACEPTADA') continue;
      const asignacion = {
        id: oferta.id,
        choferId: chofer.id,
        nombreChofer: chofer.nombre,
        valoracion: chofer.valoracion,
      };
      ocupaciones.set(reserva.id, { reserva, asignacion });
      return asignacion;
    }
    return null;
  };
  app.disable('x-powered-by');
  app.use(express.json());
  app.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }));
  app.get('/asignaciones/:id/ofertas', (request, response) => {
    response.json({ ofertas: ofertas.listar(request.params.id) });
  });
  app.post('/ofertas/:id/respuesta', (request, response) => {
    const parsed = z
      .object({ choferId: z.string().uuid(), decision: z.enum(['ACEPTAR', 'RECHAZAR']) })
      .strict()
      .safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Respuesta inválida.' });
      return;
    }
    const oferta = ofertas.responder(request.params.id, parsed.data.choferId, parsed.data.decision);
    if (!oferta) {
      response
        .status(409)
        .json({ error: 'La oferta no está vigente o no pertenece al conductor.' });
      return;
    }
    response.json({ oferta });
  });
  app.put('/asignaciones/:id', async (request, response) => {
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
    const anterior = rondas.get(reserva.id);
    if (anterior && mismoViaje(anterior.reserva, reserva)) {
      response.json({ asignacion: await anterior.resultado });
      return;
    }
    invalidar(reserva.id);
    const ronda = {
      id: randomUUID(),
      reserva,
      resultado: Promise.resolve<AsignacionChofer | null>(null),
    };
    rondas.set(reserva.id, ronda);
    ronda.resultado = buscar(reserva, ronda.id);
    const asignacion = await ronda.resultado;
    // Sin aceptación, un próximo ciclo puede abrir otra ronda con nueva disponibilidad.
    if (asignacion === null && rondas.get(reserva.id) === ronda) rondas.delete(reserva.id);
    response.json({ asignacion });
  });
  app.delete('/asignaciones/:id', (request, response) => {
    if (solicitudes.has(request.params.id)) {
      response.status(409).json({ error: 'El despacho ya fue activado.' });
      return;
    }
    invalidar(request.params.id);
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

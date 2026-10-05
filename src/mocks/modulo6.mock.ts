import express, { Request, Response } from 'express';

const app = express();
app.use(express.json());

const PORT = 4000;

// Base de datos en memoria para el Mock del Módulo 6
interface ViajeMock {
  id: string;
  clienteId: string;
  conductorId: string;
  estado: 'solicitado' | 'asignado' | 'en curso' | 'completado' | 'cancelado';
  tarifaBase: number;
  tarifaPorKm: number;
  tarifaPorMinuto: number;
  inicio: string;
  historial: Array<{ from: string; to: string; timestamp: string; detalle?: string }>;
}

const viajesDb: Map<string, ViajeMock> = new Map();

// Sembrar datos iniciales de prueba
viajesDb.set('viaje-completado-1', {
  id: 'viaje-completado-1',
  clienteId: 'cliente-123',
  conductorId: 'conductor-789',
  estado: 'completado',
  tarifaBase: 150,
  tarifaPorKm: 20,
  tarifaPorMinuto: 5,
  inicio: new Date().toISOString(),
  historial: [
    { from: 'solicitado', to: 'asignado', timestamp: new Date().toISOString() },
    { from: 'asignado', to: 'en curso', timestamp: new Date().toISOString() },
    { from: 'en curso', to: 'completado', timestamp: new Date().toISOString() },
  ],
});

viajesDb.set('viaje-en-curso-2', {
  id: 'viaje-en-curso-2',
  clienteId: 'cliente-123',
  conductorId: 'conductor-789',
  estado: 'en curso',
  tarifaBase: 150,
  tarifaPorKm: 20,
  tarifaPorMinuto: 5,
  inicio: new Date().toISOString(),
  historial: [
    { from: 'solicitado', to: 'asignado', timestamp: new Date().toISOString() },
    { from: 'asignado', to: 'en curso', timestamp: new Date().toISOString() },
  ],
});

// GET /health
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', service: 'Módulo 6 - Viajes (Mock OpenAPI)' });
});

// POST /api/viajes - Crear viaje
app.post('/api/viajes', (req: Request, res: Response) => {
  const { id, clienteId, conductorId, estado, tarifaBase, tarifaPorKm, tarifaPorMinuto, inicio } = req.body;
  if (!id || !clienteId || !conductorId || !estado) {
    return res.status(400).json({ description: 'Datos inválidos' });
  }

  const nuevoViaje: ViajeMock = {
    id,
    clienteId,
    conductorId,
    estado,
    tarifaBase,
    tarifaPorKm,
    tarifaPorMinuto,
    inicio,
    historial: [],
  };

  viajesDb.set(id, nuevoViaje);
  return res.status(201).json({ message: 'Viaje creado', viaje: nuevoViaje });
});

// GET /api/viajes/:viajeId - Consultar información de un viaje
app.get('/api/viajes/:viajeId', (req: Request, res: Response) => {
  const { viajeId } = req.params;
  const viaje = viajesDb.get(viajeId);

  if (!viaje) {
    return res.status(404).json({ message: 'Viaje no encontrado' });
  }

  return res.status(200).json(viaje);
});

// POST /api/viajes/:viajeId/finalizacion - Finalizar viaje
app.post('/api/viajes/:viajeId/finalizacion', (req: Request, res: Response) => {
  const { viajeId } = req.params;
  const viaje = viajesDb.get(viajeId);

  if (!viaje) {
    return res.status(404).json({ message: 'Viaje no encontrado' });
  }

  const estadoAnterior = viaje.estado;
  viaje.estado = 'completado';
  viaje.historial.push({
    from: estadoAnterior,
    to: 'completado',
    timestamp: new Date().toISOString(),
    detalle: 'Finalización de viaje y captura de pago',
  });

  return res.status(200).json({ message: 'Viaje finalizado', viaje });
});

// POST /api/viajes/:viajeId/cancelacion-cliente - Cancelación cliente
app.post('/api/viajes/:viajeId/cancelacion-cliente', (req: Request, res: Response) => {
  const { viajeId } = req.params;
  const { motivo } = req.body;
  const viaje = viajesDb.get(viajeId);

  if (!viaje) {
    return res.status(404).json({ message: 'Viaje no encontrado' });
  }

  const estadoAnterior = viaje.estado;
  viaje.estado = 'cancelado';
  viaje.historial.push({
    from: estadoAnterior,
    to: 'cancelado',
    timestamp: new Date().toISOString(),
    detalle: `Cancelación por cliente. Motivo: ${motivo}`,
  });

  return res.status(200).json({ message: 'Viaje cancelado', viaje });
});

// POST /api/viajes/:viajeId/cancelacion-conductor - Cancelación conductor
app.post('/api/viajes/:viajeId/cancelacion-conductor', (req: Request, res: Response) => {
  const { viajeId } = req.params;
  const { motivo } = req.body;
  const viaje = viajesDb.get(viajeId);

  if (!viaje) {
    return res.status(404).json({ message: 'Viaje no encontrado' });
  }

  const estadoAnterior = viaje.estado;
  viaje.estado = 'cancelado';
  viaje.historial.push({
    from: estadoAnterior,
    to: 'cancelado',
    timestamp: new Date().toISOString(),
    detalle: `Cancelación por conductor. Motivo: ${motivo}`,
  });

  return res.status(200).json({ message: 'Viaje cancelado y cliente retornado al despacho', viaje });
});

// GET /api/viajes/:viajeId/historial-transiciones - Historial de transiciones
app.get('/api/viajes/:viajeId/historial-transiciones', (req: Request, res: Response) => {
  const { viajeId } = req.params;
  const viaje = viajesDb.get(viajeId);

  if (!viaje) {
    return res.status(404).json({ description: 'Viaje no encontrado' });
  }

  return res.status(200).json({ historial: viaje.historial });
});

app.listen(PORT, () => {
  console.log(`📡 Mock del Módulo 6 (Viajes OpenAPI 3.0.3) ejecutándose en http://localhost:${PORT}`);
});

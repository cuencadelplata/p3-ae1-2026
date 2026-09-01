import { AppError } from '../errors/app.error.js';
import type { ReservaRow } from '../types/database.js';
import { ESTADOS_RESERVA, type EstadoReserva, type Reserva } from './reserva.js';

const esEstadoReserva = (value: string | null): value is EstadoReserva =>
  value !== null && ESTADOS_RESERVA.some((estado) => estado === value);

export const mapReservaRow = (row: ReservaRow): Reserva => {
  if (!esEstadoReserva(row.estado)) {
    throw new AppError(
      500,
      'ERROR_PERSISTENCIA',
      'La reserva almacenada tiene un estado inválido.',
    );
  }

  return {
    id: row.id,
    clienteId: row.cliente_id,
    origen: row.origen,
    destino: row.destino,
    vehiculo: row.vehiculo,
    fechaHoraProgramada: row.fecha_hora_programada,
    estado: row.estado,
    tarifaEstimada: row.tarifa_estimada,
    moneda: row.moneda,
    criterioAsignacion: row.criterio_asignacion,
    idSolicitud: row.id_solicitud,
    creadoEn: row.creado_en,
    actualizadoEn: row.actualizado_en,
  };
};

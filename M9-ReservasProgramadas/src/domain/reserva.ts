export const ESTADOS_RESERVA = [
  'PENDIENTE_ASIGNACION',
  'PROGRAMADA',
  'ACTIVANDO',
  'ACTIVADA',
  'CANCELADA',
  'FALLIDA',
] as const;

export type EstadoReserva = (typeof ESTADOS_RESERVA)[number];

export const TIPOS_VEHICULO = ['AUTO', 'MOTO'] as const;
export type TipoVehiculo = (typeof TIPOS_VEHICULO)[number];

export interface AsignacionChofer {
  id: string;
  choferId: string;
  nombreChofer: string;
  valoracion: number;
}

export interface Reserva {
  id: string;
  clienteId: string;
  origen: string;
  destino: string;
  vehiculo: TipoVehiculo;
  fechaHoraProgramada: string;
  estado: EstadoReserva;
  asignacion: AsignacionChofer | null;
  tarifaEstimada: number | null;
  moneda: string | null;
  criterioAsignacion: string | null;
  idSolicitud: string | null;
  creadoEn: string | null;
  actualizadoEn: string | null;
}

export interface CrearReserva {
  clienteId: string;
  origen: string;
  destino: string;
  vehiculo: TipoVehiculo;
  fechaHoraProgramada: string;
  tarifaEstimada?: number | null;
  moneda?: string | null;
}

export interface ActualizarReserva {
  origen?: string;
  destino?: string;
  vehiculo?: TipoVehiculo;
  fechaHoraProgramada?: string;
}

export interface CambiosReserva extends ActualizarReserva {
  asignacion?: AsignacionChofer | null;
  tarifaEstimada?: number | null;
  moneda?: string | null;
}

export interface CambioEstadoReserva {
  idSolicitud?: string | null;
}

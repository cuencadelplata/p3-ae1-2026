export const ESTADOS_RESERVA = [
  'PROGRAMADA',
  'ACTIVANDO',
  'ACTIVADA',
  'CANCELADA',
  'FALLIDA',
] as const;

export type EstadoReserva = (typeof ESTADOS_RESERVA)[number];

export const TIPOS_VEHICULO = ['AUTO', 'MOTO'] as const;
export type TipoVehiculo = (typeof TIPOS_VEHICULO)[number];

export interface Reserva {
  id: string;
  clienteId: string;
  origen: string;
  destino: string;
  vehiculo: TipoVehiculo;
  fechaHoraProgramada: string;
  estado: EstadoReserva;
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
  tarifaEstimada?: number | null;
  moneda?: string | null;
}

export interface CambioEstadoReserva {
  idSolicitud?: string | null;
}

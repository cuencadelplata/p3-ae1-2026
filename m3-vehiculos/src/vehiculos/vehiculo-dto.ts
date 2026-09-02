import { TipoServicio, type Vehiculo } from "./vehiculo-model.js";

// Lo que manda el cliente al registrar un vehículo (sin driverId: viene de la URL)
export interface VehiculoRequestDTO {
  patente: string;
  marca?: string;
  modelo?: string;
  anio: number;
  tipoServicio: TipoServicio | string;
}

// Payload interno ya validado, listo para insertar (sin id/createdAt: los pone Supabase)
export interface VehiculoParaInsertar {
  driverId: string;
  patente: string;
  marca: string | null;
  modelo: string | null;
  anio: number;
  tipoServicio: TipoServicio;
  activo: boolean;
}

// Lo que devuelve la API al cliente
export interface VehiculoResponseDTO {
  id: string;
  driverId: string;
  patente: string;
  marca: string | null;
  modelo: string | null;
  anio: number;
  tipoServicio: TipoServicio;
  activo: boolean;
  createdAt: string; // ISO string, no Date — Date no serializa bien en JSON
}

export function toVehiculoResponseDTO(vehiculo: Vehiculo): VehiculoResponseDTO {
  return {
    id: vehiculo.id,
    driverId: vehiculo.driverId,
    patente: vehiculo.patente,
    marca: vehiculo.marca,
    modelo: vehiculo.modelo,
    anio: vehiculo.anio,
    tipoServicio: vehiculo.tipoServicio,
    activo: vehiculo.activo,
    createdAt: vehiculo.createdAt.toISOString(),
  };
}

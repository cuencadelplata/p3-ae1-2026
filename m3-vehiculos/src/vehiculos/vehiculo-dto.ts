import { type TipoServicio } from "./vehiculo-model.js";

// Forma cruda del body que manda el cliente (sin garantías todavía:
// puede venir con mayúsculas/minúsculas mezcladas, campos faltantes, etc.).
// El driverId NO va acá: llega por el parámetro de la URL (/drivers/:driverId/...),
// no por el body.
export interface VehiculoRequestDTO {
  patente: string;
  marca?: string;
  modelo?: string;
  anio: number;
  tipoServicio: TipoServicio | string;
}

// Forma ya validada y normalizada, lista para insertar en la base.
// La arma validarYPrepararVehiculo() en vehiculo-service.ts.
export interface VehiculoParaInsertar {
  driverId: string;
  patente: string;
  marca: string | null;
  modelo: string | null;
  anio: number;
  tipoServicio: TipoServicio;
  activo: boolean;
}

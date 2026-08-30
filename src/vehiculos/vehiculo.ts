export enum TipoVehiculo {
  AUTO = "AUTO",
  MOTO = "MOTO",
}

export interface Vehiculo {
  id: string;
  driverId: string;
  patente: string;
  marca: string;
  modelo: string;
  anio: number;
  tipoServicio: TipoVehiculo; // auto o moto
  activo: boolean; // true si es el vehículo que usa hoy
  createdAt: Date;
}

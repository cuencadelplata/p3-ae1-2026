export enum TipoServicio {
  AUTO = "AUTO",
  MOTO = "MOTO",
}

export interface Vehiculo {
  id: string;
  driverId: string;
  patente: string;
  marca: string | null;
  modelo: string | null;
  anio: number;
  tipoServicio: TipoServicio;
  activo: boolean;
  createdAt: Date;
}
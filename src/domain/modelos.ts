export type TipoDireccion = 'FAVORITA' | 'RECIENTE';

export type UsoDireccion = 'ORIGEN' | 'DESTINO' | 'AMBOS';

export interface DatosDireccion {
  alias: string | null;
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
  tipo: TipoDireccion;
  uso: UsoDireccion;
}

export interface Direccion extends DatosDireccion {
  id: string;
  clienteId: string;
  fechaCreacion: string;
  fechaActualizacion: string;
}
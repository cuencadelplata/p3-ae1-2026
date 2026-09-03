import type { Calificacion, ResumenViaje } from '../domain/calificaciones.js';

export interface RepositorioCalificaciones {
  crearCalificacion(calificacion: Calificacion): Calificacion;
  obtenerCalificacion(clienteId: string, id: string): Calificacion | undefined;
  listarCalificaciones(clienteId: string): Calificacion[];
}

// AE1: implementación simulada. AE2: adaptador que consulte la API de M6.
export interface ConsultaViajes {
  obtenerViaje(viajeId: string): Promise<ResumenViaje | undefined>;
}
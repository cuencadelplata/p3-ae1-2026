import type {
  Direccion,
  DatosDireccion,
  TipoDireccion
} from '../domain/modelos.js';

export interface RepositorioClientes {
  crearDireccion(direccion: Direccion): Direccion;

  obtenerDireccion(
    clienteId: string,
    id: string
  ): Direccion | undefined;

  listarDirecciones(
    clienteId: string,
    tipo?: TipoDireccion
  ): Direccion[];

  actualizarDireccion(
    clienteId: string,
    id: string,
    datosEntrada: DatosDireccion & {
      fechaActualizacion: string;
    }
  ): Direccion | undefined;

  eliminarDireccion(
    clienteId: string,
    id: string
  ): boolean;

  estaDisponible(): boolean;
}
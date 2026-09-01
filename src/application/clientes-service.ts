import { randomUUID } from 'node:crypto';

import {
  datosInvalidos,
  recursoNoEncontrado
} from '../domain/errores.js';

import { validarDireccion } from '../domain/validaciones.js';
import type { Direccion } from '../domain/modelos.js';
import type { RepositorioClientes } from './ports.js';

export class ServicioClientes {
  constructor(
    private readonly repositorio: RepositorioClientes
  ) {}

  crearDireccion(clienteId: string, cuerpo: unknown): Direccion {
    const datosEntrada = validarDireccion(cuerpo);
    const fecha = new Date().toISOString();

    return this.repositorio.crearDireccion({
      id: randomUUID(),
      clienteId,
      ...datosEntrada,
      fechaCreacion: fecha,
      fechaActualizacion: fecha
    });
  }

  obtenerDireccion(clienteId: string, id: string): Direccion {
    const direccion = this.repositorio.obtenerDireccion(
      clienteId,
      id
    );

    if (!direccion) {
      throw recursoNoEncontrado('Dirección no encontrada.');
    }

    return direccion;
  }

  listarDirecciones(
    clienteId: string,
    tipo?: unknown
  ): Direccion[] {
    if (
      tipo !== undefined &&
      tipo !== 'FAVORITA' &&
      tipo !== 'RECIENTE'
    ) {
      throw datosInvalidos(
        'El filtro tipo debe ser FAVORITA o RECIENTE.'
      );
    }

    return this.repositorio.listarDirecciones(clienteId, tipo);
  }

  actualizarDireccion(
    clienteId: string,
    id: string,
    cuerpo: unknown
  ): Direccion {
    const datosEntrada = validarDireccion(cuerpo);

    const direccion = this.repositorio.actualizarDireccion(
      clienteId,
      id,
      {
        ...datosEntrada,
        fechaActualizacion: new Date().toISOString()
      }
    );

    if (!direccion) {
      throw recursoNoEncontrado('Dirección no encontrada.');
    }

    return direccion;
  }

  eliminarDireccion(clienteId: string, id: string): void {
    const eliminada = this.repositorio.eliminarDireccion(
      clienteId,
      id
    );

    if (!eliminada) {
      throw recursoNoEncontrado('Dirección no encontrada.');
    }
  }
}
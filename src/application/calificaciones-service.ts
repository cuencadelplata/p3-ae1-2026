import { randomUUID } from 'node:crypto';
import { ErrorAplicacion, recursoNoEncontrado } from '../domain/errores.js';
import { validarCalificacion } from '../domain/calificaciones.js';
import type { Calificacion, ResumenViaje } from '../domain/calificaciones.js';
import type { ConsultaViajes, RepositorioCalificaciones } from './calificaciones-ports.js';

export class ServicioCalificaciones {
  constructor(
    private readonly repositorio: RepositorioCalificaciones,
    private readonly consultaViajes: ConsultaViajes
  ) {}

  async crearCalificacion(clienteId: string, cuerpo: unknown): Promise<Calificacion> {
    const datos = validarCalificacion(cuerpo);
    let viaje: ResumenViaje | undefined;

    try {
      viaje = await this.consultaViajes.obtenerViaje(datos.viajeId);
    } catch {
      throw new ErrorAplicacion(
        503, 'VIAJES_NO_DISPONIBLE', 'No se pudo verificar el viaje. Intentá nuevamente.'
      );
    }

    if (!viaje || viaje.clienteId !== clienteId) {
      throw recursoNoEncontrado('Viaje no encontrado para este cliente.');
    }

    if (viaje.estado !== 'COMPLETADO') {
      throw new ErrorAplicacion(
        422, 'VIAJE_NO_COMPLETADO', 'Solo se pueden calificar viajes completados.'
      );
    }

    return this.repositorio.crearCalificacion({
      id: randomUUID(),
      clienteId,
      ...datos,
      conductorId: viaje.conductorId,
      fechaCreacion: new Date().toISOString()
    });
  }

  obtenerCalificacion(clienteId: string, id: string): Calificacion {
    const calificacion = this.repositorio.obtenerCalificacion(clienteId, id);
    if (!calificacion) {
      throw recursoNoEncontrado('Calificación no encontrada.');
    }
    return calificacion;
  }

  listarCalificaciones(clienteId: string): Calificacion[] {
    return this.repositorio.listarCalificaciones(clienteId);
  }
}
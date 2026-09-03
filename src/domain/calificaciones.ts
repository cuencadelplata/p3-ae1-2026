import { datosInvalidos } from './errores.js';

export interface DatosCalificacion {
  viajeId: string;
  puntuacion: number;
  comentario: string | null;
}

export interface Calificacion extends DatosCalificacion {
  id: string;
  clienteId: string;
  conductorId: string;
  fechaCreacion: string;
}

export interface ResumenViaje {
  id: string;
  clienteId: string;
  conductorId: string;
  estado: 'SOLICITADO' | 'ASIGNADO' | 'EN_CURSO' | 'COMPLETADO' | 'CANCELADO';
}

export function validarCalificacion(cuerpo: unknown): DatosCalificacion {
  if (cuerpo === null || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    throw datosInvalidos('Se requiere un objeto JSON.');
  }

  const datos = cuerpo as Record<string, unknown>;
  const permitidos = ['viajeId', 'puntuacion', 'comentario'];

  if (Object.keys(datos).some((campo) => !permitidos.includes(campo))) {
    throw datosInvalidos('La solicitud contiene campos no permitidos.');
  }

  if (typeof datos.viajeId !== 'string') {
    throw datosInvalidos('viajeId debe ser un texto.');
  }

  const viajeId = datos.viajeId.trim();
  if (viajeId.length === 0 || viajeId.length > 100) {
    throw datosInvalidos('viajeId debe tener entre 1 y 100 caracteres.');
  }

  if (
    typeof datos.puntuacion !== 'number' ||
    !Number.isInteger(datos.puntuacion) ||
    datos.puntuacion < 1 || datos.puntuacion > 5
  ) {
    throw datosInvalidos('La puntuación debe ser un entero entre 1 y 5.');
  }

  let comentario: string | null = null;
  if (datos.comentario !== undefined && datos.comentario !== null) {
    if (typeof datos.comentario !== 'string') {
      throw datosInvalidos('El comentario debe ser un texto.');
    }

    comentario = datos.comentario.trim() || null;
    if (comentario !== null && comentario.length > 500) {
      throw datosInvalidos('El comentario no puede superar 500 caracteres.');
    }
  }

  return { viajeId, puntuacion: datos.puntuacion, comentario };
}
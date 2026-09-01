import { datosInvalidos } from './errores.js';
import type { DatosDireccion } from './modelos.js';

export function validarDireccion(cuerpo: unknown): DatosDireccion {
  // Comprobamos que recibimos un objeto.
  if (
    cuerpo === null ||
    typeof cuerpo !== 'object' ||
    Array.isArray(cuerpo)
  ) {
    throw datosInvalidos('Se requiere un objeto JSON.');
  }

  const datos = cuerpo as Record<string, unknown>;

  const camposPermitidos = [
    'alias',
    'direccion',
    'latitud',
    'longitud',
    'tipo',
    'uso'
  ];

  const tieneCamposDesconocidos = Object.keys(datos).some(
    (campo) => !camposPermitidos.includes(campo)
  );

  if (tieneCamposDesconocidos) {
    throw datosInvalidos(
      'La solicitud contiene campos no permitidos.'
    );
  }

  // Validamos los textos opcionales.
  const alias = validarTextoOpcional(datos.alias, 'alias', 50);

  const direccion = validarTextoOpcional(
    datos.direccion,
    'direccion',
    250
  );

  // Las coordenadas deben enviarse juntas.
  const tieneLatitud = datos.latitud !== undefined;
  const tieneLongitud = datos.longitud !== undefined;

  if (tieneLatitud !== tieneLongitud) {
    throw datosInvalidos(
      'Latitud y longitud deben enviarse juntas.'
    );
  }

  let latitud: number | null = null;
  let longitud: number | null = null;

  if (tieneLatitud || tieneLongitud) {
    if (
      typeof datos.latitud !== 'number' ||
      typeof datos.longitud !== 'number' ||
      !Number.isFinite(datos.latitud) ||
      !Number.isFinite(datos.longitud)
    ) {
      throw datosInvalidos(
        'Las coordenadas deben ser números válidos.'
      );
    }

    if (datos.latitud < -90 || datos.latitud > 90) {
      throw datosInvalidos(
        'La latitud debe estar entre -90 y 90.'
      );
    }

    if (datos.longitud < -180 || datos.longitud > 180) {
      throw datosInvalidos(
        'La longitud debe estar entre -180 y 180.'
      );
    }

    latitud = datos.latitud;
    longitud = datos.longitud;
  }

  // Necesitamos una dirección escrita o coordenadas.
  if (direccion === null && latitud === null) {
    throw datosInvalidos(
      'Debe indicar una dirección o un par de coordenadas.'
    );
  }

  const tipo = datos.tipo;

  if (tipo !== 'FAVORITA' && tipo !== 'RECIENTE') {
    throw datosInvalidos(
      'El tipo debe ser FAVORITA o RECIENTE.'
    );
  }

  const uso = datos.uso === undefined ? 'AMBOS' : datos.uso;

  if (uso !== 'ORIGEN' && uso !== 'DESTINO' && uso !== 'AMBOS') {
    throw datosInvalidos(
      'El uso debe ser ORIGEN, DESTINO o AMBOS.'
    );
  }

  return {
    alias,
    direccion,
    latitud,
    longitud,
    tipo,
    uso
  };
}

function validarTextoOpcional(
  valor: unknown,
  campo: string,
  longitudMaxima: number
): string | null {
  if (valor === undefined) {
    return null;
  }

  if (typeof valor !== 'string') {
    throw datosInvalidos(`${campo} debe ser un texto.`);
  }

  const valorLimpio = valor.trim();

  if (valorLimpio.length === 0) {
    throw datosInvalidos(`${campo} no puede estar vacío.`);
  }

  if (valorLimpio.length > longitudMaxima) {
    throw datosInvalidos(
      `${campo} no puede superar ${longitudMaxima} caracteres.`
    );
  }

  return valorLimpio;
}
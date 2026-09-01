export class ErrorAplicacion extends Error {
  constructor(
    public readonly estadoHttp: number,
    public readonly codigo: string,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorAplicacion';
  }
}

export function datosInvalidos(mensaje: string): ErrorAplicacion {
  return new ErrorAplicacion(400, 'DATOS_INVALIDOS', mensaje);
}

export function recursoNoEncontrado(
  mensaje = 'Recurso no encontrado.'
): ErrorAplicacion {
  return new ErrorAplicacion(404, 'NO_ENCONTRADO', mensaje);
}
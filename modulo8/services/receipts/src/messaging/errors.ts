/**
 * Error de un mensaje que nunca va a poder procesarse (sobre invalido, evento o
 * version no soportados, datos que no cumplen el contrato). El consumidor lo
 * envia a la cola de descarte sin reintentar.
 *
 * Cualquier otro error se considera transitorio (base de datos no disponible,
 * corte de red) y se reintenta.
 */
export class PermanentMessageError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'PermanentMessageError';
  }
}

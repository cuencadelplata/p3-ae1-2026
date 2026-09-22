import { z } from 'zod';

import type { AsignacionChofer, Reserva } from '../domain/reserva.js';
import { AppError } from '../errors/app.error.js';

export interface AsignacionClient {
  asignar(reserva: Reserva): Promise<AsignacionChofer | null>;
  liberar(reservaId: string): Promise<void>;
}

export const asignacionSchema = z.object({
  id: z.string().uuid(),
  choferId: z.string().uuid(),
  nombreChofer: z.string().min(1),
  valoracion: z.number().min(0).max(5),
});

export class HttpAsignacionClient implements AsignacionClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 3_000,
  ) {}

  private async solicitar(id: string, method: string, reserva?: Reserva): Promise<Response> {
    try {
      const response = await fetch(new URL(`/asignaciones/${id}`, this.baseUrl), {
        method,
        headers: { 'content-type': 'application/json' },
        body: reserva === undefined ? undefined : JSON.stringify({ reserva }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`M5 respondió HTTP ${response.status}.`);
      return response;
    } catch (cause) {
      throw new AppError(
        503,
        'SERVICIO_EXTERNO_NO_DISPONIBLE',
        'No se pudo confirmar la asignación con M5. Reintente la operación.',
        { cause },
      );
    }
  }

  public async asignar(reserva: Reserva): Promise<AsignacionChofer | null> {
    const response = await this.solicitar(reserva.id, 'PUT', reserva);
    try {
      return z.object({ asignacion: asignacionSchema.nullable() }).parse(await response.json())
        .asignacion;
    } catch (cause) {
      throw new AppError(
        503,
        'SERVICIO_EXTERNO_NO_DISPONIBLE',
        'M5 devolvió una asignación inválida.',
        { cause },
      );
    }
  }

  public async liberar(reservaId: string): Promise<void> {
    await this.solicitar(reservaId, 'DELETE');
  }
}

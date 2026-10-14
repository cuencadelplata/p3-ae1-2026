import { z } from 'zod';

import type { Reserva } from '../domain/reserva.js';
import { AppError } from '../errors/app.error.js';

export interface SolicitudDespachoCreada {
  solicitudId: string;
  estado: string;
}

export interface DespachoClient {
  crearSolicitud(reserva: Reserva): Promise<SolicitudDespachoCreada>;
}

const responseSchema = z.object({
  solicitudId: z.string().uuid(),
  estado: z.string().min(1),
});

export class HttpDespachoClient implements DespachoClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 3_000,
  ) {}

  public async crearSolicitud(reserva: Reserva): Promise<SolicitudDespachoCreada> {
    try {
      const response = await fetch(new URL('/api/v1/ride-requests', this.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': reserva.id,
          'x-client-id': reserva.clienteId,
        },
        body: JSON.stringify({
          origin: {
            latitude: -27.4606,
            longitude: -58.9838,
            address: reserva.origen,
          },
          destination: {
            latitude: -27.4712,
            longitude: -58.9915,
            address: reserva.destino,
          },
          vehicleType: reserva.vehiculo,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`M5 respondió HTTP ${response.status}.`);
      }

      return responseSchema.parse(await response.json());
    } catch (error) {
      throw new AppError(
        503,
        'SERVICIO_EXTERNO_NO_DISPONIBLE',
        'El servicio de despacho M5 no está disponible.',
        { cause: error },
      );
    }
  }
}

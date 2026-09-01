import { z } from 'zod';

import type { TipoVehiculo } from '../domain/reserva.js';
import { AppError } from '../errors/app.error.js';

export interface SolicitudTarifa {
  origen: string;
  destino: string;
  vehiculo: TipoVehiculo;
}

export interface EstimacionTarifa {
  tarifaEstimada: number;
  moneda: string;
}

export interface TarifaClient {
  estimar(input: SolicitudTarifa): Promise<EstimacionTarifa>;
}

const responseSchema = z.object({
  tarifaEstimada: z.number().nonnegative(),
  moneda: z.string().min(1),
});

export class HttpTarifaClient implements TarifaClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 3_000,
  ) {}

  public async estimar(input: SolicitudTarifa): Promise<EstimacionTarifa> {
    try {
      const response = await fetch(new URL('/tarifas/estimar', this.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`M7 respondió HTTP ${response.status}.`);
      }

      return responseSchema.parse(await response.json());
    } catch (error) {
      throw new AppError(
        503,
        'SERVICIO_EXTERNO_NO_DISPONIBLE',
        'El servicio de tarifas M7 no está disponible.',
        { cause: error },
      );
    }
  }
}

import type { TipoVehiculo } from '../domain/reserva.js';
import type { RouteSnapshot } from '../domain/route-snapshot.js';
import { M7TariffClient } from './m7-tariff.client.js';

export interface SolicitudTarifa {
  vehiculo: TipoVehiculo;
  route: RouteSnapshot;
}

export interface EstimacionTarifa {
  tarifaEstimada: number;
  moneda: string;
  estimacionId: string;
  distanciaKm: number;
  tiempoEstimadoMin: number;
  calculadoEn: string;
}

export interface TarifaClient {
  estimar(input: SolicitudTarifa): Promise<EstimacionTarifa>;
}

/** @deprecated Use M7TariffClient. Se conserva como alias de compatibilidad interna. */
export class HttpTarifaClient implements TarifaClient {
  private readonly client: M7TariffClient;

  public constructor(baseUrl: string, timeoutMs = 3_000) {
    this.client = new M7TariffClient(baseUrl, timeoutMs);
  }

  public async estimar(input: SolicitudTarifa): Promise<EstimacionTarifa> {
    return this.client.estimar(input);
  }
}

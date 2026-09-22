import type { DespachoClient } from '../clients/despacho.client.js';
import type { ReservaRepository } from '../repositories/reserva.repository.js';
import { conReservaExclusiva } from './reserva-lock.js';

export interface ResultadoActivacion {
  reservaId: string;
  activada: boolean;
}

export class ActivacionReservaService {
  public constructor(
    private readonly repository: ReservaRepository,
    private readonly despachoClient: DespachoClient,
  ) {}

  public async activar(reservaId: string): Promise<ResultadoActivacion> {
    return conReservaExclusiva(this.repository, reservaId, () => this.activarExclusiva(reservaId));
  }

  private async activarExclusiva(reservaId: string): Promise<ResultadoActivacion> {
    const actual = await this.repository.obtenerPorId(reservaId);
    if (
      actual === null ||
      actual.asignacion === null ||
      Date.parse(actual.fechaHoraProgramada) > Date.now()
    ) {
      return { reservaId, activada: false };
    }
    const reclamada = await this.repository.cambiarEstado(reservaId, 'PROGRAMADA', 'ACTIVANDO');
    if (reclamada === null) {
      return { reservaId, activada: false };
    }

    try {
      const solicitud = await this.despachoClient.crearSolicitud(reclamada);
      const activada = await this.repository.cambiarEstado(reservaId, 'ACTIVANDO', 'ACTIVADA', {
        idSolicitud: solicitud.solicitudId,
      });
      return { reservaId, activada: activada !== null };
    } catch (error) {
      await this.repository.cambiarEstado(reservaId, 'ACTIVANDO', 'FALLIDA');
      throw error;
    }
  }
}

import type { TarifaClient } from '../clients/tarifa.client.js';
import type { ActualizarReserva, CrearReserva, Reserva } from '../domain/reserva.js';
import { AppError } from '../errors/app.error.js';
import type { ReservaRepository } from '../repositories/reserva.repository.js';

const normalizarUbicacion = (value: string): string =>
  value.trim().normalize('NFKC').toLocaleLowerCase('es');

export class ReservaService {
  public constructor(
    private readonly repository: ReservaRepository,
    private readonly tarifaClient: TarifaClient,
  ) {}

  public async crear(input: CrearReserva): Promise<Reserva> {
    this.validarFechaFutura(input.fechaHoraProgramada);
    this.validarOrigenDestino(input.origen, input.destino);

    let tarifa: { tarifaEstimada: number; moneda: string } | null = null;
    try {
      tarifa = await this.tarifaClient.estimar({
        origen: input.origen,
        destino: input.destino,
        vehiculo: input.vehiculo,
      });
    } catch {
      // La política de degradación permite crear la reserva sin tarifa.
    }

    return this.repository.crear({
      ...input,
      tarifaEstimada: tarifa?.tarifaEstimada ?? null,
      moneda: tarifa?.moneda ?? 'ARS',
    });
  }

  public async listar(): Promise<Reserva[]> {
    return this.repository.listar();
  }

  public async obtenerPorId(id: string): Promise<Reserva> {
    const reserva = await this.repository.obtenerPorId(id);
    if (reserva === null) {
      throw new AppError(404, 'RESERVA_NO_ENCONTRADA', 'La reserva no existe.');
    }
    return reserva;
  }

  public async actualizar(id: string, input: ActualizarReserva): Promise<Reserva> {
    const actual = await this.obtenerPorId(id);
    if (actual.estado !== 'PROGRAMADA') {
      throw new AppError(
        409,
        'RESERVA_NO_MODIFICABLE',
        'Solo se pueden modificar reservas en estado PROGRAMADA.',
      );
    }

    const origen = input.origen ?? actual.origen;
    const destino = input.destino ?? actual.destino;
    const fecha = input.fechaHoraProgramada ?? actual.fechaHoraProgramada;
    this.validarOrigenDestino(origen, destino);
    this.validarFechaFutura(fecha);

    const actualizada = await this.repository.actualizarProgramada(id, input);
    if (actualizada === null) {
      throw new AppError(
        409,
        'RESERVA_NO_MODIFICABLE',
        'La reserva dejó de estar disponible para modificación.',
      );
    }
    return actualizada;
  }

  public async cancelar(id: string): Promise<Reserva> {
    const actual = await this.obtenerPorId(id);
    if (actual.estado !== 'PROGRAMADA') {
      throw new AppError(
        409,
        'RESERVA_NO_CANCELABLE',
        'Solo se pueden cancelar reservas en estado PROGRAMADA.',
      );
    }

    const cancelada = await this.repository.cancelarProgramada(id);
    if (cancelada === null) {
      throw new AppError(
        409,
        'RESERVA_NO_CANCELABLE',
        'La reserva dejó de estar disponible para cancelación.',
      );
    }
    return cancelada;
  }

  private validarFechaFutura(fecha: string): void {
    if (!Number.isFinite(Date.parse(fecha)) || Date.parse(fecha) <= Date.now()) {
      throw new AppError(
        400,
        'FECHA_INVALIDA',
        'La fecha y hora programada debe ser válida y futura.',
      );
    }
  }

  private validarOrigenDestino(origen: string, destino: string): void {
    if (normalizarUbicacion(origen) === normalizarUbicacion(destino)) {
      throw new AppError(
        400,
        'DATOS_INVALIDOS',
        'El origen y el destino deben ser diferentes.',
      );
    }
  }
}

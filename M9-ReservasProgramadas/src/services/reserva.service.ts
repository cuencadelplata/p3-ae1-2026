import type { TarifaClient } from '../clients/tarifa.client.js';
import type { AsignacionClient } from '../clients/asignacion.client.js';
import { conReservaExclusiva } from './reserva-lock.js';
import type {
  ActualizarReserva,
  CambiosReserva,
  CrearReserva,
  Reserva,
} from '../domain/reserva.js';
import { AppError } from '../errors/app.error.js';
import type { ReservaRepository } from '../repositories/reserva.repository.js';

const normalizarUbicacion = (value: string): string =>
  value.trim().normalize('NFKC').toLocaleLowerCase('es');

export class ReservaService {
  public constructor(
    private readonly repository: ReservaRepository,
    private readonly tarifaClient: TarifaClient,
    private readonly asignacionClient: AsignacionClient,
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

    const creada = await this.repository.crear({
      ...input,
      tarifaEstimada: tarifa?.tarifaEstimada ?? null,
      moneda: tarifa?.moneda ?? 'ARS',
    });
    return this.reintentarAsignacion(creada.id);
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
    return conReservaExclusiva(this.repository, id, () => this.actualizarExclusiva(id, input));
  }

  private async actualizarExclusiva(id: string, input: ActualizarReserva): Promise<Reserva> {
    const actual = await this.obtenerPorId(id);
    if (actual.estado !== 'PROGRAMADA' && actual.estado !== 'PENDIENTE_ASIGNACION') {
      throw new AppError(
        409,
        'RESERVA_NO_MODIFICABLE',
        'Solo se pueden modificar reservas PROGRAMADA o PENDIENTE_ASIGNACION.',
      );
    }

    const origen = input.origen ?? actual.origen;
    const destino = input.destino ?? actual.destino;
    const fecha = input.fechaHoraProgramada ?? actual.fechaHoraProgramada;
    this.validarOrigenDestino(origen, destino);
    this.validarFechaFutura(fecha);

    const cambios: CambiosReserva = { ...input };
    const requiereNuevaTarifa =
      input.origen !== undefined || input.destino !== undefined || input.vehiculo !== undefined;

    if (requiereNuevaTarifa) {
      try {
        const tarifa = await this.tarifaClient.estimar({
          origen,
          destino,
          vehiculo: input.vehiculo ?? actual.vehiculo,
        });
        cambios.tarifaEstimada = tarifa.tarifaEstimada;
        cambios.moneda = tarifa.moneda;
      } catch {
        cambios.tarifaEstimada = null;
        cambios.moneda = actual.moneda ?? 'ARS';
      }
    }

    // Liberar primero evita conservar una asignación incompatible ante una edición.
    // Si M5 no confirma la liberación, la edición se rechaza y puede reintentarse.
    await this.asignacionClient.liberar(id);
    cambios.asignacion = null;
    const actualizada = await this.repository.actualizarProgramada(id, cambios);
    if (actualizada === null) {
      throw new AppError(
        409,
        'RESERVA_NO_MODIFICABLE',
        'La reserva dejó de estar disponible para modificación.',
      );
    }
    return this.asignarExclusiva(actualizada);
  }

  public async cancelar(id: string): Promise<Reserva> {
    return conReservaExclusiva(this.repository, id, () => this.cancelarExclusiva(id));
  }

  private async cancelarExclusiva(id: string): Promise<Reserva> {
    const actual = await this.obtenerPorId(id);
    if (actual.estado !== 'PROGRAMADA' && actual.estado !== 'PENDIENTE_ASIGNACION') {
      throw new AppError(
        409,
        'RESERVA_NO_CANCELABLE',
        'Solo se pueden cancelar reservas PROGRAMADA o PENDIENTE_ASIGNACION.',
      );
    }

    await this.asignacionClient.liberar(id);
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

  public async reintentarAsignacion(id: string): Promise<Reserva> {
    return conReservaExclusiva(this.repository, id, async () => {
      const reserva = await this.obtenerPorId(id);
      if (
        reserva.estado !== 'PENDIENTE_ASIGNACION' ||
        Date.parse(reserva.fechaHoraProgramada) <= Date.now()
      )
        return reserva;
      return this.asignarExclusiva(reserva);
    });
  }

  private async asignarExclusiva(reserva: Reserva): Promise<Reserva> {
    let asignacion;
    try {
      asignacion = await this.asignacionClient.asignar(reserva);
    } catch {
      // La reserva ya está guardada: el scheduler reintentará mientras sea futura.
      return reserva;
    }
    return (await this.repository.actualizarProgramada(reserva.id, { asignacion })) ?? reserva;
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
      throw new AppError(400, 'DATOS_INVALIDOS', 'El origen y el destino deben ser diferentes.');
    }
  }
}

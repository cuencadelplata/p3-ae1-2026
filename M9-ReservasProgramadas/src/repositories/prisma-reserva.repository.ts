import { Prisma, PrismaClient, EstadoReserva as PrismaEstadoReserva, TipoVehiculo as PrismaTipoVehiculo } from '@prisma/client';
import type {
  CambiosReserva,
  CambioEstadoReserva,
  CrearReserva,
  EstadoReserva,
  Reserva,
  TipoVehiculo,
} from '../domain/reserva.js';
import type { ReservaRepository } from './reserva.repository.js';

const mapEstado = (estado: PrismaEstadoReserva): EstadoReserva => estado as EstadoReserva;
const mapTipoVehiculo = (vehiculo: PrismaTipoVehiculo): TipoVehiculo => vehiculo as TipoVehiculo;

const decimalToNumber = (value: Prisma.Decimal | number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  return Number(value);
};

const mapAsignacion = (
  asignacionId: string | null,
  choferId: string | null,
  nombreChofer: string | null,
  valoracion: Prisma.Decimal | number | null,
): Reserva['asignacion'] => {
  if (!asignacionId || !choferId || !nombreChofer) {
    return null;
  }

  return {
    id: asignacionId,
    choferId,
    nombreChofer,
    valoracion: decimalToNumber(valoracion) ?? 0,
  };
};

const reservaFromPrisma = (reserva: {
  id: string;
  clienteId: string;
  origen: string;
  destino: string;
  vehiculo: PrismaTipoVehiculo;
  fechaHoraProgramada: Date;
  estado: PrismaEstadoReserva;
  asignacionId: string | null;
  choferId: string | null;
  nombreChofer: string | null;
  valoracion: Prisma.Decimal | number | null;
  tarifaEstimada: Prisma.Decimal | number | null;
  moneda: string | null;
  criterioAsignacion: string | null;
  idSolicitud: string | null;
  creadoEn: Date;
  actualizadoEn: Date;
}): Reserva => ({
  id: reserva.id,
  clienteId: reserva.clienteId,
  origen: reserva.origen,
  destino: reserva.destino,
  vehiculo: mapTipoVehiculo(reserva.vehiculo),
  fechaHoraProgramada: reserva.fechaHoraProgramada.toISOString(),
  estado: mapEstado(reserva.estado),
  asignacion: mapAsignacion(
    reserva.asignacionId,
    reserva.choferId,
    reserva.nombreChofer,
    reserva.valoracion,
  ),
  tarifaEstimada: decimalToNumber(reserva.tarifaEstimada),
  moneda: reserva.moneda,
  criterioAsignacion: reserva.criterioAsignacion,
  idSolicitud: reserva.idSolicitud,
  creadoEn: reserva.creadoEn.toISOString(),
  actualizadoEn: reserva.actualizadoEn.toISOString(),
});

export class PrismaReservaRepository implements ReservaRepository {
  public constructor(private readonly prisma: PrismaClient = new PrismaClient()) {}

  public async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  public async crear(input: CrearReserva): Promise<Reserva> {
    const reserva = await this.prisma.$transaction(async (tx) => {
      const creada = await tx.reserva.create({
        data: {
          clienteId: input.clienteId,
          origen: input.origen,
          destino: input.destino,
          vehiculo: input.vehiculo as PrismaTipoVehiculo,
          fechaHoraProgramada: new Date(input.fechaHoraProgramada),
          estado: PrismaEstadoReserva.PENDIENTE_ASIGNACION,
          tarifaEstimada: input.tarifaEstimada === null || input.tarifaEstimada === undefined ? null : new Prisma.Decimal(input.tarifaEstimada),
          moneda: input.moneda ?? 'ARS',
          criterioAsignacion: 'MEJOR_CALIFICACION',
        },
      });

      await tx.outboxEvent.create({
        data: {
          tipo: 'ReservaCreada',
          aggregateType: 'Reserva',
          aggregateId: creada.id,
          payload: {
            reservaId: creada.id,
            clienteId: creada.clienteId,
            estado: creada.estado,
            fechaHoraProgramada: creada.fechaHoraProgramada.toISOString(),
          },
          status: 'PENDING',
          reservaId: creada.id,
        },
      });

      return creada;
    });

    return reservaFromPrisma(reserva);
  }

  public async obtenerPorId(id: string): Promise<Reserva | null> {
    const reserva = await this.prisma.reserva.findUnique({ where: { id } });
    return reserva === null ? null : reservaFromPrisma(reserva);
  }

  public async listar(): Promise<Reserva[]> {
    const reservas = await this.prisma.reserva.findMany({
      orderBy: { fechaHoraProgramada: 'asc' },
    });
    return reservas.map(reservaFromPrisma);
  }

  public async listarPaginado(page = 1, pageSize = 20): Promise<Reserva[]> {
    const offset = (page - 1) * pageSize;
    const reservas = await this.prisma.reserva.findMany({
      orderBy: { fechaHoraProgramada: 'asc' },
      skip: offset,
      take: pageSize,
    });
    return reservas.map(reservaFromPrisma);
  }

  public async actualizarProgramada(id: string, input: CambiosReserva): Promise<Reserva | null> {
    const actual = await this.prisma.reserva.findUnique({ where: { id } });
    if (actual === null) return null;

    if (actual.estado !== PrismaEstadoReserva.PROGRAMADA && actual.estado !== PrismaEstadoReserva.PENDIENTE_ASIGNACION) {
      return null;
    }

    const actualizada = await this.prisma.$transaction(async (tx) => {
      const actualizacion = await tx.reserva.update({
        where: { id },
        data: {
          origen: input.origen ?? actual.origen,
          destino: input.destino ?? actual.destino,
          vehiculo: input.vehiculo ? (input.vehiculo as PrismaTipoVehiculo) : actual.vehiculo,
          fechaHoraProgramada: input.fechaHoraProgramada ? new Date(input.fechaHoraProgramada) : actual.fechaHoraProgramada,
          tarifaEstimada:
            input.tarifaEstimada === undefined
              ? actual.tarifaEstimada
              : input.tarifaEstimada === null
                ? null
                : new Prisma.Decimal(input.tarifaEstimada),
          moneda: input.moneda ?? actual.moneda,
          asignacionId: input.asignacion === undefined ? actual.asignacionId : input.asignacion?.id ?? null,
          choferId: input.asignacion === undefined ? actual.choferId : input.asignacion?.choferId ?? null,
          nombreChofer: input.asignacion === undefined ? actual.nombreChofer : input.asignacion?.nombreChofer ?? null,
          valoracion:
            input.asignacion === undefined
              ? actual.valoracion
              : input.asignacion === null
                ? null
                : new Prisma.Decimal(input.asignacion.valoracion),
          criterioAsignacion: actual.criterioAsignacion ?? 'MEJOR_CALIFICACION',
          estado:
            input.asignacion === undefined
              ? actual.estado
              : input.asignacion === null
                ? PrismaEstadoReserva.PENDIENTE_ASIGNACION
                : PrismaEstadoReserva.PROGRAMADA,
          actualizadoEn: new Date(),
        },
      });

      await tx.outboxEvent.create({
        data: {
          tipo: 'ReservaActualizada',
          aggregateType: 'Reserva',
          aggregateId: actualizacion.id,
          payload: {
            reservaId: actualizacion.id,
            estado: actualizacion.estado,
            actualizadoEn: actualizacion.actualizadoEn.toISOString(),
          },
          status: 'PENDING',
          reservaId: actualizacion.id,
        },
      });

      return actualizacion;
    });

    return actualizada === null ? null : reservaFromPrisma(actualizada);
  }

  public async cancelarProgramada(id: string): Promise<Reserva | null> {
    const cancelada = await this.prisma.$transaction(async (tx) => {
      const reserva = await tx.reserva.findUnique({ where: { id } });
      if (reserva === null) return null;
      if (reserva.estado !== PrismaEstadoReserva.PROGRAMADA && reserva.estado !== PrismaEstadoReserva.PENDIENTE_ASIGNACION) {
        return null;
      }

      const actualizada = await tx.reserva.update({
        where: { id },
        data: {
          estado: PrismaEstadoReserva.CANCELADA,
          asignacionId: null,
          choferId: null,
          nombreChofer: null,
          valoracion: null,
          actualizadoEn: new Date(),
        },
      });

      await tx.outboxEvent.create({
        data: {
          tipo: 'ReservaCancelada',
          aggregateType: 'Reserva',
          aggregateId: actualizada.id,
          payload: {
            reservaId: actualizada.id,
            estado: actualizada.estado,
          },
          status: 'PENDING',
          reservaId: actualizada.id,
        },
      });

      return actualizada;
    });

    return cancelada === null ? null : reservaFromPrisma(cancelada);
  }

  public async buscarPendientes(fechaLimite: Date, limite = 100): Promise<Reserva[]> {
    const reservas = await this.prisma.reserva.findMany({
      where: {
        estado: PrismaEstadoReserva.PROGRAMADA,
        asignacionId: { not: null },
        fechaHoraProgramada: { lte: fechaLimite },
      },
      orderBy: { fechaHoraProgramada: 'asc' },
      take: limite,
    });

    return reservas.map(reservaFromPrisma);
  }

  public async cambiarEstado(
    id: string,
    estadoEsperado: EstadoReserva,
    nuevoEstado: EstadoReserva,
    cambio: CambioEstadoReserva = {},
  ): Promise<Reserva | null> {
    const actual = await this.prisma.$transaction(async (tx) => {
      const existente = await tx.reserva.findUnique({ where: { id } });
      if (existente === null || mapEstado(existente.estado) !== estadoEsperado) {
        return null;
      }

      const actualizada = await tx.reserva.update({
        where: { id },
        data: {
          estado: nuevoEstado as PrismaEstadoReserva,
          idSolicitud: cambio.idSolicitud ?? existente.idSolicitud,
          actualizadoEn: new Date(),
        },
      });

      await tx.outboxEvent.create({
        data: {
          tipo: 'ReservaEstadoCambiado',
          aggregateType: 'Reserva',
          aggregateId: actualizada.id,
          payload: {
            reservaId: actualizada.id,
            estadoAnterior: estadoEsperado,
            estadoNuevo: nuevoEstado,
            idSolicitud: actualizada.idSolicitud,
          },
          status: 'PENDING',
          reservaId: actualizada.id,
        },
      });

      return actualizada;
    });

    return actual === null ? null : reservaFromPrisma(actual);
  }
}

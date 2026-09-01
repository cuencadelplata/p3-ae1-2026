import type { SupabaseClient } from '@supabase/supabase-js';

import { mapReservaRow } from '../domain/reserva.mapper.js';
import type {
  ActualizarReserva,
  CambioEstadoReserva,
  CrearReserva,
  EstadoReserva,
  Reserva,
} from '../domain/reserva.js';
import { persistenceError } from '../errors/app.error.js';
import type { Database, ReservaInsert, ReservaUpdate } from '../types/database.js';
import type { ReservaRepository } from './reserva.repository.js';

const COLUMNAS_RESERVA =
  'id,cliente_id,origen,destino,vehiculo,fecha_hora_programada,estado,tarifa_estimada,moneda,criterio_asignacion,id_solicitud,creado_en,actualizado_en';

export class SupabaseReservaRepository implements ReservaRepository {
  public constructor(private readonly client: SupabaseClient<Database>) {}

  public async crear(input: CrearReserva): Promise<Reserva> {
    const payload: ReservaInsert = {
      cliente_id: input.clienteId,
      origen: input.origen,
      destino: input.destino,
      vehiculo: input.vehiculo,
      fecha_hora_programada: input.fechaHoraProgramada,
      estado: 'PROGRAMADA',
      tarifa_estimada: input.tarifaEstimada ?? null,
      moneda: input.moneda ?? 'ARS',
    };
    const { data, error } = await this.client
      .from('reservas')
      .insert(payload)
      .select(COLUMNAS_RESERVA)
      .single();

    if (error) throw persistenceError(error);
    return mapReservaRow(data);
  }

  public async obtenerPorId(id: string): Promise<Reserva | null> {
    const { data, error } = await this.client
      .from('reservas')
      .select(COLUMNAS_RESERVA)
      .eq('id', id)
      .maybeSingle();

    if (error) throw persistenceError(error);
    return data === null ? null : mapReservaRow(data);
  }

  public async listar(): Promise<Reserva[]> {
    const { data, error } = await this.client
      .from('reservas')
      .select(COLUMNAS_RESERVA)
      .order('fecha_hora_programada', { ascending: true });

    if (error) throw persistenceError(error);
    return data.map(mapReservaRow);
  }

  public async actualizarProgramada(
    id: string,
    input: ActualizarReserva,
  ): Promise<Reserva | null> {
    const payload: ReservaUpdate = {
      actualizado_en: new Date().toISOString(),
      ...(input.origen === undefined ? {} : { origen: input.origen }),
      ...(input.destino === undefined ? {} : { destino: input.destino }),
      ...(input.vehiculo === undefined ? {} : { vehiculo: input.vehiculo }),
      ...(input.fechaHoraProgramada === undefined
        ? {}
        : { fecha_hora_programada: input.fechaHoraProgramada }),
    };
    const { data, error } = await this.client
      .from('reservas')
      .update(payload)
      .eq('id', id)
      .eq('estado', 'PROGRAMADA')
      .select(COLUMNAS_RESERVA)
      .maybeSingle();

    if (error) throw persistenceError(error);
    return data === null ? null : mapReservaRow(data);
  }

  public async cancelarProgramada(id: string): Promise<Reserva | null> {
    return this.cambiarEstado(id, 'PROGRAMADA', 'CANCELADA');
  }

  public async buscarPendientes(fechaLimite: Date, limite = 100): Promise<Reserva[]> {
    const { data, error } = await this.client
      .from('reservas')
      .select(COLUMNAS_RESERVA)
      .eq('estado', 'PROGRAMADA')
      .lte('fecha_hora_programada', fechaLimite.toISOString())
      .order('fecha_hora_programada', { ascending: true })
      .limit(limite);

    if (error) throw persistenceError(error);
    return data.map(mapReservaRow);
  }

  public async cambiarEstado(
    id: string,
    estadoEsperado: EstadoReserva,
    nuevoEstado: EstadoReserva,
    cambio: CambioEstadoReserva = {},
  ): Promise<Reserva | null> {
    const payload: ReservaUpdate = {
      estado: nuevoEstado,
      actualizado_en: new Date().toISOString(),
      ...(cambio.idSolicitud === undefined ? {} : { id_solicitud: cambio.idSolicitud }),
    };
    const { data, error } = await this.client
      .from('reservas')
      .update(payload)
      .eq('id', id)
      .eq('estado', estadoEsperado)
      .select(COLUMNAS_RESERVA)
      .maybeSingle();

    if (error) throw persistenceError(error);
    return data === null ? null : mapReservaRow(data);
  }
}

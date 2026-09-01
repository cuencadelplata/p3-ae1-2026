import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { SupabaseReservaRepository } from '../../src/repositories/supabase-reserva.repository.js';
import type { Database, ReservaRow } from '../../src/types/database.js';

const row: ReservaRow = {
  id: '00000000-0000-4000-8000-000000000001',
  cliente_id: '00000000-0000-4000-8000-000000000002',
  origen: 'A',
  destino: 'B',
  vehiculo: 'AUTO',
  fecha_hora_programada: '2030-01-01T00:00:00.000Z',
  estado: 'ACTIVANDO',
  tarifa_estimada: null,
  moneda: 'ARS',
  criterio_asignacion: 'MEJOR_CALIFICACION',
  id_solicitud: null,
  creado_en: '2029-01-01T00:00:00.000Z',
  actualizado_en: '2029-01-01T00:00:00.000Z',
};

describe('SupabaseReservaRepository', () => {
  it('reclama con un único UPDATE condicionado por id y estado', async () => {
    const builder = {
      update: vi.fn(),
      eq: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: row, error: null })),
    };
    builder.update.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    builder.select.mockReturnValue(builder);
    const client = {
      from: vi.fn(() => builder),
    } as unknown as SupabaseClient<Database>;
    const repository = new SupabaseReservaRepository(client);

    const reclamada = await repository.cambiarEstado(
      row.id,
      'PROGRAMADA',
      'ACTIVANDO',
    );

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'ACTIVANDO' }),
    );
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'id', row.id);
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'estado', 'PROGRAMADA');
    expect(reclamada?.estado).toBe('ACTIVANDO');
  });
});

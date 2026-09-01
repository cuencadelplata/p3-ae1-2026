import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { afterEach, describe, expect, it } from 'vitest';

import { SupabaseReservaRepository } from '../../src/repositories/supabase-reserva.repository.js';
import { AppError } from '../../src/errors/app.error.js';
import type { Database } from '../../src/types/database.js';

const enabled =
  process.env.RUN_SUPABASE_INTEGRATION === 'true' &&
  process.env.SUPABASE_URL !== undefined &&
  process.env.SUPABASE_KEY !== undefined;

describe.skipIf(!enabled)('SupabaseReservaRepository (proyecto real)', () => {
  const client = createClient<Database>(
    process.env.SUPABASE_URL ?? 'http://localhost',
    process.env.SUPABASE_KEY ?? 'disabled',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const repository = new SupabaseReservaRepository(client);
  const createdIds: string[] = [];

  afterEach(async () => {
    if (createdIds.length > 0) {
      await client.from('reservas').delete().in('id', createdIds.splice(0));
    }
  });

  it('persiste CRUD y garantiza un solo reclamo concurrente', async () => {
    let reserva;
    try {
      reserva = await repository.crear({
        clienteId: crypto.randomUUID(),
        origen: 'Origen test Codex',
        destino: 'Destino test Codex',
        vehiculo: 'AUTO',
        fechaHoraProgramada: new Date(Date.now() + 3_600_000).toISOString(),
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw new Error(`Supabase rechazó la prueba: ${JSON.stringify(error.cause)}`);
      }
      throw error;
    }
    createdIds.push(reserva.id);

    expect((await repository.obtenerPorId(reserva.id))?.id).toBe(reserva.id);
    expect(await repository.actualizarProgramada(reserva.id, { destino: 'Destino actualizado' }))
      .toMatchObject({ destino: 'Destino actualizado' });

    const reclamos = await Promise.all([
      repository.cambiarEstado(reserva.id, 'PROGRAMADA', 'ACTIVANDO'),
      repository.cambiarEstado(reserva.id, 'PROGRAMADA', 'ACTIVANDO'),
    ]);
    expect(reclamos.filter((resultado) => resultado !== null)).toHaveLength(1);
  });
});

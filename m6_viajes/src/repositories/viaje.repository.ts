import pool from '../db/pool.js';
import type { Viaje } from '../models/viaje.model.js';
import { EstadoViaje } from '../models/viaje.model.js';

export async function crear(viaje: Viaje): Promise<void> {
    await pool.query(
        `INSERT INTO viajes (id, cliente_id, estado, origen, destino, codigo_verificacion, fecha_creacion)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [viaje.id, viaje.clienteId, viaje.estado, viaje.origen, viaje.destino, viaje.codigoVerificacion, viaje.fechaCreacion]
    );
}

export async function buscarPorId(id: string): Promise<Viaje | null> {
    const { rows } = await pool.query('SELECT * FROM viajes WHERE id = $1', [id]);
    if (rows.length === 0) return null;
    return mapRow(rows[0]);
}

export async function actualizarEstado(id: string, estado: EstadoViaje, conductorId?: string): Promise<void> {
    await pool.query(
        `UPDATE viajes SET estado = $1, conductor_id = COALESCE($2, conductor_id) WHERE id = $3`,
        [estado, conductorId ?? null, id]
    );
}

function mapRow(row: any): Viaje {
    return {
        id: row.id,
        clienteId: row.cliente_id,
        conductorId: row.conductor_id,
        estado: row.estado,
        origen: row.origen,
        destino: row.destino,
        codigoVerificacion: row.codigo_verificacion,
        fechaCreacion: row.fecha_creacion,
    };
}
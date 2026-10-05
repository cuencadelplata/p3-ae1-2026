import pool from '../db/pool.js';
import type { PoolClient } from 'pg';
import type { Viaje } from '../models/viaje.model.js';
import { EstadoViaje } from '../models/viaje.model.js';
//en este archivo definimos las funciones que interactúan con la base de datos para crear, buscar y actualizar viajes. Estas funciones son llamadas por los controladores del módulo de viajes.

export interface FinalizacionPersistida {
    tiempoMinutos: number;
    distanciaKm: number;
    horaFin: Date;
    metodoPago: string;
    total: number;
    origen: { latitude: number; longitude: number; address?: string };
    destino: { latitude: number; longitude: number; address?: string };
    tipoVehiculo: 'auto' | 'moto';
    fuenteMetrica: 'M4';
    metricasEstimadas: true;
    paymentId: string;
}

export type FinalizacionAtomicaResult =
    | { kind: 'not-found' }
    | { kind: 'invalid-state'; estado: string }
    | { kind: 'completed'; viaje: Viaje; finalizacion: FinalizacionPersistida };

let extensionSchemaPromise: Promise<void> | undefined;

async function ensureExtensionSchema(): Promise<void> {
    extensionSchemaPromise ??= pool.query(`
        CREATE TABLE IF NOT EXISTS viaje_finalizaciones (
            viaje_id VARCHAR(50) PRIMARY KEY REFERENCES viajes(id) ON DELETE CASCADE,
            data JSONB NOT NULL,
            payment_id TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS viaje_transiciones (
            id BIGSERIAL PRIMARY KEY,
            viaje_id VARCHAR(50) NOT NULL REFERENCES viajes(id) ON DELETE CASCADE,
            estado_anterior VARCHAR(30) NOT NULL,
            estado_nuevo VARCHAR(30) NOT NULL,
            timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
            detalle TEXT
        );
        CREATE INDEX IF NOT EXISTS viaje_transiciones_viaje_id_id_idx
            ON viaje_transiciones(viaje_id, id);
    `).then(() => undefined).catch((error: unknown) => {
        extensionSchemaPromise = undefined;
        throw error;
    });
    await extensionSchemaPromise;
}

async function rollback(client: PoolClient): Promise<void> {
    try {
        await client.query('ROLLBACK');
    } catch (error) {
        console.error('No se pudo revertir la transacción de viaje:', error);
    }
}

export async function crear(viaje: Viaje): Promise<void> {
    await pool.query(
        `INSERT INTO viajes (id, cliente_id, estado, origen, destino, codigo_verificacion, fecha_creacion)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [viaje.id, viaje.clienteId, viaje.estado, viaje.origen, viaje.destino, viaje.codigoVerificacion, viaje.fechaCreacion]
    );
}

export async function actualizarQR(
    id: string,
    qr: { token: string; qrDataUrl: string; expiresAt: Date }
): Promise<void> {
    await pool.query(
        `UPDATE viajes
         SET codigo_verificacion = $1, qr_data_url = $2, qr_expires_at = $3
         WHERE id = $4`,
        [qr.token, qr.qrDataUrl, qr.expiresAt, id]
    );
}

export async function buscarPorId(id: string): Promise<Viaje | null> {
    const { rows } = await pool.query('SELECT * FROM viajes WHERE id = $1', [id]);
    if (rows.length === 0) return null;
    return mapRow(rows[0]);
}

export async function cancelarSiCancelable(id: string, actor?: string, motivo?: string): Promise<Viaje | null> {
    await ensureExtensionSchema();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const current = await client.query('SELECT estado FROM viajes WHERE id = $1 FOR UPDATE', [id]);
        if (current.rows.length === 0) {
            await client.query('COMMIT');
            return null;
        }
        const estadoAnterior = current.rows[0].estado as string;
        if (![EstadoViaje.SOLICITADO, EstadoViaje.CONDUCTOR_EN_CAMINO].includes(estadoAnterior as EstadoViaje)) {
            await client.query('COMMIT');
            return null;
        }
        const { rows } = await client.query(
            `UPDATE viajes SET estado = $1 WHERE id = $2 RETURNING *`,
            [EstadoViaje.CANCELADO, id]
        );
        const detalle = [
            'Cancelación de viaje',
            actor ? `por ${actor}` : '',
            motivo ? `: ${motivo}` : '',
        ].filter(Boolean).join(' ');
        await insertarTransicion(client, id, estadoAnterior, EstadoViaje.CANCELADO, detalle);
        await client.query('COMMIT');
        return mapRow(rows[0]);
    } catch (error) {
        await rollback(client);
        throw error;
    } finally {
        client.release();
    }
}

export async function actualizarEstado(id: string, estado: EstadoViaje, conductorId?: string): Promise<void> {
    await ensureExtensionSchema();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const current = await client.query('SELECT estado FROM viajes WHERE id = $1 FOR UPDATE', [id]);
        if (current.rows.length > 0) {
            const estadoAnterior = current.rows[0].estado as string;
            await client.query(
                `UPDATE viajes SET estado = $1, conductor_id = COALESCE($2, conductor_id) WHERE id = $3`,
                [estado, conductorId ?? null, id]
            );
            if (estadoAnterior !== estado) {
                await insertarTransicion(client, id, estadoAnterior, estado, detalleTransicion(estado));
            }
        }
        await client.query('COMMIT');
    } catch (error) {
        await rollback(client);
        throw error;
    } finally {
        client.release();
    }
}

export async function finalizarSiEnCurso(
    id: string,
    ejecutarFinalizacion: (viaje: Viaje, inicio: Date) => Promise<FinalizacionPersistida>,
): Promise<FinalizacionAtomicaResult> {
    await ensureExtensionSchema();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const current = await client.query('SELECT * FROM viajes WHERE id = $1 FOR UPDATE', [id]);
        if (current.rows.length === 0) {
            await client.query('COMMIT');
            return { kind: 'not-found' };
        }

        const viaje = mapRow(current.rows[0]);
        if (viaje.estado !== EstadoViaje.EN_CURSO) {
            await client.query('COMMIT');
            return { kind: 'invalid-state', estado: viaje.estado };
        }

        const inicioResult = await client.query(
            `SELECT timestamp FROM viaje_transiciones
             WHERE viaje_id = $1 AND estado_nuevo = $2
             ORDER BY id DESC LIMIT 1`,
            [id, EstadoViaje.EN_CURSO]
        );
        const inicio = inicioResult.rows[0]?.timestamp
            ? new Date(inicioResult.rows[0].timestamp)
            : viaje.fechaCreacion;
        const finalizacion = await ejecutarFinalizacion(viaje, inicio);
        const { rows } = await client.query(
            `UPDATE viajes SET estado = $1 WHERE id = $2 AND estado = $3 RETURNING *`,
            [EstadoViaje.COMPLETADO, id, EstadoViaje.EN_CURSO]
        );
        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return { kind: 'invalid-state', estado: viaje.estado };
        }

        await client.query(
            `INSERT INTO viaje_finalizaciones (viaje_id, data, payment_id)
             VALUES ($1, $2::jsonb, $3)`,
            [id, JSON.stringify(finalizacion), finalizacion.paymentId]
        );
        await insertarTransicion(client, id, viaje.estado, EstadoViaje.COMPLETADO, 'Finalización del viaje');
        await client.query('COMMIT');
        return { kind: 'completed', viaje: mapRow(rows[0]), finalizacion };
    } catch (error) {
        await rollback(client);
        throw error;
    } finally {
        client.release();
    }
}

export async function buscarHistorialTransiciones(
    id: string,
): Promise<{ exists: boolean; historial: Array<{ from: string; to: string; timestamp: Date; detalle?: string }> }> {
    await ensureExtensionSchema();
    const viaje = await pool.query('SELECT 1 FROM viajes WHERE id = $1', [id]);
    if (viaje.rows.length === 0) return { exists: false, historial: [] };

    const { rows } = await pool.query(
        `SELECT estado_anterior, estado_nuevo, timestamp, detalle
         FROM viaje_transiciones WHERE viaje_id = $1 ORDER BY id`,
        [id]
    );
    return {
        exists: true,
        historial: rows.map((row) => ({
            from: row.estado_anterior,
            to: row.estado_nuevo,
            timestamp: row.timestamp,
            ...(row.detalle ? { detalle: row.detalle } : {}),
        })),
    };
}

async function insertarTransicion(
    client: PoolClient,
    viajeId: string,
    from: string,
    to: string,
    detalle: string,
): Promise<void> {
    await client.query(
        `INSERT INTO viaje_transiciones (viaje_id, estado_anterior, estado_nuevo, detalle)
         VALUES ($1, $2, $3, $4)`,
        [viajeId, from, to, detalle]
    );
}

function detalleTransicion(estado: EstadoViaje): string {
    switch (estado) {
        case EstadoViaje.CONDUCTOR_EN_CAMINO:
            return 'Asignación del conductor';
        case EstadoViaje.ARRIBADO:
            return 'Arribo del conductor';
        case EstadoViaje.EN_CURSO:
            return 'Inicio de viaje';
        case EstadoViaje.CANCELADO:
            return 'Cancelación de viaje';
        case EstadoViaje.COMPLETADO:
            return 'Finalización del viaje';
        default:
            return `Cambio de estado a ${estado}`;
    }
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
        qrCode: row.qr_data_url,
        qrExpiresAt: row.qr_expires_at,
        fechaCreacion: row.fecha_creacion,
    };
}
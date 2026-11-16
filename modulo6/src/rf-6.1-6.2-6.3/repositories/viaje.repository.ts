import pool from '../db/pool.js';
import type { PoolClient } from 'pg';
import type { Viaje } from '../models/viaje.model.js';
import { EstadoViaje } from '../models/viaje.model.js';
import { eventosViajeFinalizado } from '../services/eventos-viaje.service.js';
//en este archivo definimos las funciones que interactúan con la base de datos para crear, buscar y actualizar viajes. Estas funciones son llamadas por los controladores del módulo de viajes.

export interface FinalizacionPersistida {
    /** Inicio real del viaje: momento de la transición a EN_CURSO. */
    inicio: Date;
    horaFin: Date;
    /** Duración real (horaFin - inicio). */
    tiempoMinutos: number;
    /** ETA estimado por M4, conservado como referencia. */
    tiempoEstimadoMinutos: number;
    /** Distancia estimada por M4 entre origen y destino (M6 no recibe el recorrido GPS). */
    distanciaKm: number;
    metodoPago: string;
    total: number;
    moneda: string;
    origen: { latitude: number; longitude: number; address?: string };
    destino: { latitude: number; longitude: number; address?: string };
    tipoVehiculo: 'auto' | 'moto';
    /** Origen de la métrica estimada (distancia). */
    fuenteMetrica: 'M4';
    metricasEstimadas: true;
    estadoPago: 'pendiente' | 'autorizado';
    paymentId: string;
}

export type FinalizacionAtomicaResult =
    | { kind: 'not-found' }
    | { kind: 'invalid-state'; estado: string }
    | { kind: 'completed'; viaje: Viaje; finalizacion: FinalizacionPersistida; repetida: boolean };

export interface HistorialTransicion {
    from: string | null;
    to: string;
    timestamp: Date;
    detalle?: string;
}

export interface ViajeConHistorial extends Omit<Viaje, 'codigoVerificacion' | 'qrCode' | 'qrExpiresAt'> {
    finalizacion: FinalizacionPersistida | null;
    historialTransiciones: HistorialTransicion[];
}

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
        CREATE INDEX IF NOT EXISTS viajes_cliente_id_fecha_idx
            ON viajes(cliente_id, fecha_creacion DESC, id DESC);

        -- RF-6.7: la creación del viaje se registra como transición sin estado anterior.
        ALTER TABLE viaje_transiciones ALTER COLUMN estado_anterior DROP NOT NULL;

        -- RF-6.7: el historial y la finalización son de solo inserción. Ni la aplicación
        -- ni un DELETE en cascada desde viajes pueden reescribir lo ya registrado.
        CREATE OR REPLACE FUNCTION m6_historial_inmutable() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'La tabla % es de solo inserción (RF-6.7)', TG_TABLE_NAME
                USING ERRCODE = 'insufficient_privilege';
        END;
        $$;
        CREATE OR REPLACE TRIGGER viaje_transiciones_inmutable
            BEFORE UPDATE OR DELETE ON viaje_transiciones
            FOR EACH ROW EXECUTE FUNCTION m6_historial_inmutable();
        CREATE OR REPLACE TRIGGER viaje_finalizaciones_inmutable
            BEFORE UPDATE OR DELETE ON viaje_finalizaciones
            FOR EACH ROW EXECUTE FUNCTION m6_historial_inmutable();

        -- RF-6.4: outbox transaccional para los eventos de finalización.
        CREATE TABLE IF NOT EXISTS viaje_eventos_outbox (
            message_id UUID PRIMARY KEY,
            viaje_id VARCHAR(50) NOT NULL,
            exchange TEXT NOT NULL,
            routing_key TEXT NOT NULL,
            payload JSONB NOT NULL,
            creado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            publicado_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS viaje_eventos_outbox_pendientes_idx
            ON viaje_eventos_outbox(creado_at) WHERE publicado_at IS NULL;
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
    await ensureExtensionSchema();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO viajes (id, cliente_id, estado, origen, destino, codigo_verificacion, fecha_creacion)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [viaje.id, viaje.clienteId, viaje.estado, viaje.origen, viaje.destino, viaje.codigoVerificacion, viaje.fechaCreacion]
        );
        // RF-6.7: la solicitud es el primer hecho del historial.
        await insertarTransicion(client, viaje.id, null, viaje.estado, 'Solicitud del viaje');
        await client.query('COMMIT');
    } catch (error) {
        await rollback(client);
        throw error;
    } finally {
        client.release();
    }
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

export async function marcarArribado(id: string): Promise<boolean> {
    await ensureExtensionSchema();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const current = await client.query(
            'SELECT estado FROM viajes WHERE id = $1 FOR UPDATE',
            [id]
        );
        if (current.rows.length === 0 || current.rows[0].estado !== EstadoViaje.CONDUCTOR_EN_CAMINO) {
            await client.query('COMMIT');
            return false;
        }

        const { rows } = await client.query(
            `UPDATE viajes
             SET estado = $1
             WHERE id = $2 AND estado = $3
             RETURNING id`,
            [EstadoViaje.ARRIBADO, id, EstadoViaje.CONDUCTOR_EN_CAMINO]
        );
        if (rows.length === 1) {
            await insertarTransicion(
                client,
                id,
                current.rows[0].estado as string,
                EstadoViaje.ARRIBADO,
                detalleTransicion(EstadoViaje.ARRIBADO)
            );
        }
        await client.query('COMMIT');
        return rows.length === 1;
    } catch (error) {
        await rollback(client);
        throw error;
    } finally {
        client.release();
    }
}

export async function buscarPorId(id: string): Promise<Viaje | null> {
    const { rows } = await pool.query('SELECT * FROM viajes WHERE id = $1', [id]);
    if (rows.length === 0) return null;
    return mapRow(rows[0]);
}

export async function buscarViajesPorCliente(clienteId: string): Promise<ViajeConHistorial[]> {
    await ensureExtensionSchema();
    const { rows } = await pool.query(
        `SELECT viajes.*, viaje_finalizaciones.data AS finalizacion_data
         FROM viajes
         LEFT JOIN viaje_finalizaciones ON viaje_finalizaciones.viaje_id = viajes.id
         WHERE viajes.cliente_id = $1
         ORDER BY viajes.fecha_creacion DESC, viajes.id DESC`,
        [clienteId]
    );
    if (rows.length === 0) return [];

    const viajes: ViajeConHistorial[] = rows.map((row) => {
        const viaje = mapRow(row);
        return {
            id: viaje.id,
            clienteId: viaje.clienteId,
            ...(viaje.conductorId ? { conductorId: viaje.conductorId } : {}),
            estado: viaje.estado,
            origen: viaje.origen,
            destino: viaje.destino,
            fechaCreacion: viaje.fechaCreacion,
            finalizacion: parseFinalizacion(row.finalizacion_data),
            historialTransiciones: [],
        };
    });
    const viajesPorId = new Map(viajes.map((viaje) => [viaje.id, viaje]));
    const ids = viajes.map((viaje) => viaje.id);
    const historialResult = await pool.query(
        `SELECT viaje_id, estado_anterior, estado_nuevo, timestamp, detalle
         FROM viaje_transiciones
         WHERE viaje_id = ANY($1::varchar[])
         ORDER BY viaje_id, id`,
        [ids]
    );

    for (const row of historialResult.rows) {
        const viaje = viajesPorId.get(row.viaje_id as string);
        if (!viaje) continue;
        viaje.historialTransiciones.push({
            from: estadoHistorial(row.estado_anterior as string | null),
            to: estadoHistorial(row.estado_nuevo as string),
            timestamp: row.timestamp as Date,
            ...(row.detalle ? { detalle: row.detalle as string } : {}),
        });
    }
    return viajes;
}

export async function buscarViajesPorConductor(conductorId: string): Promise<Array<Pick<Viaje, 'id' | 'clienteId' | 'conductorId' | 'estado' | 'origen' | 'destino' | 'fechaCreacion'>>> {
    const { rows } = await pool.query(
        `SELECT id, cliente_id, conductor_id, estado, origen, destino, fecha_creacion
         FROM viajes
         WHERE conductor_id = $1
         ORDER BY fecha_creacion DESC, id DESC`,
        [conductorId]
    );
    return rows.map((row) => ({
        id: row.id as string,
        clienteId: row.cliente_id as string,
        conductorId: row.conductor_id as string,
        estado: row.estado as EstadoViaje,
        origen: row.origen as string,
        destino: row.destino as string,
        fechaCreacion: row.fecha_creacion as Date,
    }));
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
        // Serializa las finalizaciones del mismo viaje sin bloquear la fila: mientras se
        // consulta a M4/M7 el viaje sigue legible y modificable por otros flujos.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`m6:finalizacion:${id}`]);

        const current = await client.query(
            `SELECT viajes.*, viaje_finalizaciones.data AS finalizacion_data
             FROM viajes
             LEFT JOIN viaje_finalizaciones ON viaje_finalizaciones.viaje_id = viajes.id
             WHERE viajes.id = $1`,
            [id]
        );
        if (current.rows.length === 0) {
            await client.query('COMMIT');
            return { kind: 'not-found' };
        }

        const viaje = mapRow(current.rows[0]);
        const finalizacionPrevia = parseFinalizacion(current.rows[0].finalizacion_data);
        if (viaje.estado === EstadoViaje.COMPLETADO && finalizacionPrevia) {
            // RNF-08: un reintento devuelve la finalización ya registrada, sin volver a cobrar.
            await client.query('COMMIT');
            return { kind: 'completed', viaje, finalizacion: finalizacionPrevia, repetida: true };
        }
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
            const estadoActual = await pool.query('SELECT estado FROM viajes WHERE id = $1', [id]);
            return { kind: 'invalid-state', estado: estadoActual.rows[0]?.estado ?? viaje.estado };
        }

        await client.query(
            `INSERT INTO viaje_finalizaciones (viaje_id, data, payment_id)
             VALUES ($1, $2::jsonb, $3)`,
            [id, JSON.stringify(finalizacion), finalizacion.paymentId]
        );
        await insertarTransicion(client, id, viaje.estado, EstadoViaje.COMPLETADO, 'Finalización del viaje');
        const completado = mapRow(rows[0]);
        for (const evento of eventosViajeFinalizado({
            viajeId: completado.id,
            clienteId: completado.clienteId,
            conductorId: completado.conductorId ?? null,
            finalizadoAt: finalizacion.horaFin,
            total: finalizacion.total,
            paymentId: finalizacion.paymentId,
        })) {
            await client.query(
                `INSERT INTO viaje_eventos_outbox (message_id, viaje_id, exchange, routing_key, payload)
                 VALUES ($1, $2, $3, $4, $5::jsonb)`,
                [evento.messageId, id, evento.exchange, evento.routingKey, JSON.stringify(evento.payload)]
            );
        }
        await client.query('COMMIT');
        return { kind: 'completed', viaje: completado, finalizacion, repetida: false };
    } catch (error) {
        await rollback(client);
        throw error;
    } finally {
        client.release();
    }
}

/** Nombres de estado del historial, alineados con los estados del escenario (M6). */
export function estadoHistorial(estado: string): string;
export function estadoHistorial(estado: string | null): string | null;
export function estadoHistorial(estado: string | null): string | null {
    switch (estado) {
        case null:
            return null;
        case EstadoViaje.SOLICITADO:
            return 'solicitado';
        case EstadoViaje.ASIGNADO:
            return 'asignado';
        case EstadoViaje.CONDUCTOR_EN_CAMINO:
            return 'conductor en camino';
        case EstadoViaje.ARRIBADO:
            return 'arribado';
        case EstadoViaje.EN_CURSO:
            return 'en curso';
        case EstadoViaje.COMPLETADO:
            return 'completado';
        case EstadoViaje.CANCELADO:
            return 'cancelado';
        default:
            return estado.toLowerCase();
    }
}

function parseFinalizacion(value: unknown): FinalizacionPersistida | null {
    if (!value) return null;
    const data = typeof value === 'string'
        ? JSON.parse(value) as FinalizacionPersistida
        : value as FinalizacionPersistida;
    return {
        ...data,
        ...(data.inicio ? { inicio: new Date(data.inicio) } : {}),
        horaFin: new Date(data.horaFin),
    };
}

export async function buscarHistorialTransiciones(
    id: string,
): Promise<{ exists: boolean; historial: HistorialTransicion[] }> {
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
    from: string | null,
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
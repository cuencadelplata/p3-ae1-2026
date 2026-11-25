import db from "../config/database";

export interface AltaVehiculoGuardada {
    usuarioID: string;
    vehiculo: unknown;
    documentacionVehiculo: unknown[];
    actualizadoEn: string;
}

export function guardarAltaVehiculo(
    usuarioId: number,
    vehiculo: unknown,
    documentacion: unknown[]
): AltaVehiculoGuardada {
    const vehiculoJson = JSON.stringify(vehiculo ?? null);
    const documentacionJson = JSON.stringify(documentacion);
    db.prepare(`
        INSERT INTO altas_vehiculo (usuario_id, vehiculo_json, documentacion_json, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(usuario_id) DO UPDATE SET
            vehiculo_json = excluded.vehiculo_json,
            documentacion_json = excluded.documentacion_json,
            updated_at = CURRENT_TIMESTAMP
    `).run(usuarioId, vehiculoJson, documentacionJson);

    return leerAlta(usuarioId)!;
}

export function listarAltasVehiculo(): AltaVehiculoGuardada[] {
    const filas = db.prepare(`
        SELECT usuario_id, vehiculo_json, documentacion_json, updated_at
        FROM altas_vehiculo
        ORDER BY updated_at ASC
    `).all() as {
        usuario_id: number;
        vehiculo_json: string;
        documentacion_json: string;
        updated_at: string;
    }[];

    return filas.map((fila) => ({
        usuarioID: String(fila.usuario_id),
        vehiculo: JSON.parse(fila.vehiculo_json),
        documentacionVehiculo: JSON.parse(fila.documentacion_json),
        actualizadoEn: fila.updated_at
    }));
}

function leerAlta(usuarioId: number): AltaVehiculoGuardada | undefined {
    const fila = db.prepare(`
        SELECT usuario_id, vehiculo_json, documentacion_json, updated_at
        FROM altas_vehiculo
        WHERE usuario_id = ?
    `).get(usuarioId) as {
        usuario_id: number;
        vehiculo_json: string;
        documentacion_json: string;
        updated_at: string;
    } | undefined;
    if (!fila) return undefined;
    return {
        usuarioID: String(fila.usuario_id),
        vehiculo: JSON.parse(fila.vehiculo_json),
        documentacionVehiculo: JSON.parse(fila.documentacion_json),
        actualizadoEn: fila.updated_at
    };
}

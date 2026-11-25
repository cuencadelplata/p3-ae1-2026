import type { Request, Response } from 'express';
import type { Viaje } from '../models/viaje.model.js';

export async function autorizarQr(req: Request, res: Response, viaje: Viaje, rol: 'CLIENTE' | 'CONDUCTOR'): Promise<boolean> {
    const url = process.env.M6_QR_IDENTITY_URL;
    // El Compose común configura M1. Los entornos aislados de M6 conservan su contrato de prueba.
    if (!url) return true;
    const authorization = req.get('authorization');
    if (!authorization || !/^Bearer [^ ]+$/i.test(authorization)) {
        res.status(401).json({ error: 'Iniciá sesión para confirmar el viaje.' });
        return false;
    }
    try {
        const respuesta = await fetch(url, {
            headers: { Authorization: authorization },
            signal: AbortSignal.timeout(2000),
            redirect: 'error',
        });
        if (respuesta.status === 401 || respuesta.status === 403) {
            res.status(401).json({ error: 'La sesión ya no es válida.' });
            return false;
        }
        if (!respuesta.ok) throw new Error('M1 no disponible');
        const identidad = await respuesta.json() as { valid?: unknown; role?: unknown; userId?: unknown };
        if (identidad.valid !== true) {
            res.status(401).json({ error: 'La sesión ya no es válida.' });
            return false;
        }
        const participante = rol === 'CLIENTE' ? viaje.clientUserId : viaje.driverUserId;
        if (!participante || identidad.role !== rol || identidad.userId !== participante) {
            res.status(403).json({ error: 'Esta acción corresponde al otro participante o a otro viaje.' });
            return false;
        }
        return true;
    } catch {
        res.status(503).json({ error: 'No se pudo verificar tu sesión. Volvé a intentar.' });
        return false;
    }
}

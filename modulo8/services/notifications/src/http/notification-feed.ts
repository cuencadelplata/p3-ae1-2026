import type { RequestHandler } from 'express';
import type { Pool } from 'pg';

export function createNotificationFeed(pool: Pool, identityUrl?: string): RequestHandler {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const auth = request.get('Authorization');
    const jwt = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/i.exec(auth ?? '');
    const unauthorized = () => response.status(401).json({
      error: { message: 'Iniciá sesión para ver tus avisos.' },
    });
    if (!jwt || !auth) {
      unauthorized();
      return;
    }

    try {
      // M1 valida la firma y la sesión. Los tokens delegados se reservan a M5.
      const claims: unknown = JSON.parse(Buffer.from(jwt[1].split('.')[1], 'base64url').toString());
      if (!claims || typeof claims !== 'object' || 'act' in claims || ('aud' in claims && claims.aud === 'm5')) {
        unauthorized();
        return;
      }
    } catch {
      unauthorized();
      return;
    }

    try {
      if (!identityUrl) throw new Error('M1 sin configurar');
      const identity = await fetch(identityUrl, {
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(2500),
      });
      if (identity.status === 401 || identity.status === 403) {
        unauthorized();
        return;
      }
      if (!identity.ok) throw new Error('Identidad no disponible');
      const user = await identity.json() as { valid?: boolean; userId?: number };
      if (user.valid !== true || !Number.isSafeInteger(user.userId) || Number(user.userId) < 1) {
        unauthorized();
        return;
      }

      const { rows } = await pool.query(
        `SELECT notification_id AS "id", title, message, created_at AS "createdAt"
           FROM notifications.notifications
          WHERE recipient_id = $1
          ORDER BY created_at DESC, notification_id DESC
          LIMIT 20`,
        [String(user.userId)],
      );
      response.json({ data: rows });
    } catch {
      response.status(503).json({ error: { message: 'No pudimos cargar tus avisos. Volvé a intentar.' } });
    }
  };
}

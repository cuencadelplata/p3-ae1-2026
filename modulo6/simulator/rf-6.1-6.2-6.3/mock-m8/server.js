import express from 'express';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';

const app = express();
app.use(express.json());

const qrs = new Map(); // token -> { tripId, used, expiresAt, qrDataUrl }
const activeTokenByTripId = new Map();
const pendingQrByTripId = new Map();

async function obtenerOCrearQR(tripId) {
    const activeToken = activeTokenByTripId.get(tripId);
    const activeQr = activeToken ? qrs.get(activeToken) : null;
    if (activeQr && !activeQr.used && activeQr.expiresAt.getTime() > Date.now()) {
        return { qr: activeQr, created: false };
    }

    const pending = pendingQrByTripId.get(tripId);
    if (pending) return { qr: await pending, created: false };

    const creation = (async () => {
        const token = randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        const qrDataUrl = await QRCode.toDataURL(token);
        const qr = { tripId, used: false, expiresAt, qrDataUrl, token };
        qrs.set(token, qr);
        activeTokenByTripId.set(tripId, token);
        return qr;
    })();
    pendingQrByTripId.set(tripId, creation);

    try {
        return { qr: await creation, created: true };
    } finally {
        pendingQrByTripId.delete(tripId);
    }
}

app.post('/qr', async (req, res) => {
    const { tripId } = req.body;
    if (!tripId) {
        return res.status(400).json({ error: { code: 'TRIP_ID_REQUIRED' } });
    }

    try {
        const { qr, created } = await obtenerOCrearQR(tripId);
        return res.status(created ? 201 : 200).json({
            token: qr.token,
            qrDataUrl: qr.qrDataUrl,
            expiresAt: qr.expiresAt.toISOString(),
        });
    } catch {
        return res.status(503).json({ error: { code: 'QR_GENERATION_FAILED' } });
    }
});

app.post('/qr/validate', (req, res) => {
    const { tripId, token } = req.body;
    const registro = qrs.get(token);

    if (!registro) {
        return res.status(404).json({ error: { code: 'QR_NOT_FOUND' } });
    }
    if (registro.tripId !== tripId) {
        return res.status(404).json({ error: { code: 'QR_NOT_FOUND' } });
    }
    if (registro.used) {
        return res.status(409).json({ error: { code: 'QR_ALREADY_USED' } });
    }
    if (Date.now() > registro.expiresAt.getTime()) {
        return res.status(410).json({ error: { code: 'QR_EXPIRED' } });
    }

    registro.used = true;
    return res.status(200).json({ valid: true });
});

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

const port = Number(process.env.PORT) || 3103;
app.listen(port, () => console.log(`Mock M8 corriendo en http://localhost:${port}`));
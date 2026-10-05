import express from 'express';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';

const app = express();
app.use(express.json());

const qrs = new Map(); // token -> { tripId, used, expiresAt }

app.post('/qr', async (req, res) => {
    const { tripId } = req.body;
    if (!tripId) {
        return res.status(400).json({ error: { code: 'TRIP_ID_REQUIRED' } });
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const qrDataUrl = await QRCode.toDataURL(token);

    qrs.set(token, { tripId, used: false, expiresAt });

    return res.status(201).json({ token, qrDataUrl, expiresAt: expiresAt.toISOString() });
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
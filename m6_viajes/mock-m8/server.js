import express from 'express';

const app = express();
app.use(express.json());

// Simula el Redis de M8 (QR con TTL, de un solo uso), en memoria
const qrs = new Map(); // codigo -> { tripId, usado, expira }

app.post('/qr', (req, res) => {
    const { tripId } = req.body;
    if (!tripId) {
        return res.status(400).json({ error: 'Falta tripId' });
    }

    const codigo = Math.random().toString(36).substring(2, 8).toUpperCase();
    const expira = Date.now() + 5 * 60 * 1000; // 5 minutos

    qrs.set(codigo, { tripId, usado: false, expira });

    return res.status(201).json({ codigo });
});

app.post('/qr/validate', (req, res) => {
    const { tripId, codigo } = req.body;
    const registro = qrs.get(codigo);

    if (!registro) {
        return res.json({ valido: false, motivo: 'QR inexistente' });
    }
    if (registro.tripId !== tripId) {
        return res.json({ valido: false, motivo: 'QR no corresponde a este viaje' });
    }
    if (registro.usado) {
        return res.json({ valido: false, motivo: 'QR ya utilizado' });
    }
    if (Date.now() > registro.expira) {
        return res.json({ valido: false, motivo: 'QR expirado' });
    }

    registro.usado = true;
    return res.json({ valido: true });
});

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

app.listen(4001, () => console.log('Mock M8 corriendo en http://localhost:4001'));
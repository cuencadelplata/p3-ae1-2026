import express from 'express';
import viajesRoutes from './routes/viajes.routes.js';
import clientesRoutes from './routes/clientes.routes.js';
import { cerrarPublicador, despacharEventosPendientes } from './services/eventos-viaje.service.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Enlazamos las rutas del modulo
app.use('/api/viajes', viajesRoutes);
app.use('/api/clientes', clientesRoutes);

app.listen(PORT, () => {
    console.log(`Servidor del modulo corriendo en http://localhost:${PORT}`);
});

// RF-6.4: relay del outbox. Reintenta los eventos de finalización que no se pudieron
// publicar en el momento (por ejemplo, con RabbitMQ caído).
const OUTBOX_INTERVALO_MS = Number(process.env.OUTBOX_INTERVAL_MS) || 5000;
const relayOutbox = setInterval(() => void despacharEventosPendientes(), OUTBOX_INTERVALO_MS);
relayOutbox.unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
        clearInterval(relayOutbox);
        void cerrarPublicador().finally(() => process.exit(0));
    });
}
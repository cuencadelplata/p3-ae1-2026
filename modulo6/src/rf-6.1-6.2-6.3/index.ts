import express from 'express';
import { resolve } from 'node:path';
import viajesRoutes from './routes/viajes.routes.js';
import clientesRoutes from './routes/clientes.routes.js';
import conductoresRoutes from './routes/conductores.routes.js';
import { cerrarPublicador, despacharEventosPendientes } from './services/eventos-viaje.service.js';
import { middlewareObservabilidad, responderMetricas } from '../observabilidad/http.js';
import { logger } from '../observabilidad/logger.js';
import { inicializarSeriesDominio, registrarGaugesTripDb } from '../observabilidad/metricas.js';
import { estadisticasTripDb } from './repositories/viaje.repository.js';

const app = express();
const PORT = process.env.PORT || 3000;

// RNF-13/RNF-19: X-Request-Id, métricas y log estructurado por solicitud.
app.use(middlewareObservabilidad());
app.use(express.json());

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Métricas Prometheus que lee Grafana Alloy.
registrarGaugesTripDb(estadisticasTripDb);
inicializarSeriesDominio();
app.get('/metrics', (_req, res) => void responderMetricas(res));

// Panel de viajes (RF-6.1/6.2/6.3) servido por el servicio de Viajes.
app.use(express.static(resolve(process.cwd(), 'frontend')));

// Enlazamos las rutas del modulo
app.use('/api/viajes', viajesRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/conductores', conductoresRoutes);

app.listen(PORT, () => {
    logger.info({ port: Number(PORT) }, 'Servidor del módulo Viajes iniciado');
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
import { logger } from '../observabilidad/logger.js';
import { createViajeApi, HttpViajesApiClient } from './api.js';
const server = createViajeApi({
    viajesApi: new HttpViajesApiClient(process.env.RF6_API_URL ?? 'http://127.0.0.1:3000'),
});
server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => {
    logger.info({ port: Number(process.env.PORT ?? 3000) }, 'Fachada RF-6.4/6.7 iniciada (API y front)');
});

import { createApp } from './app.js';
import { HttpDespachoClient } from './clients/despacho.client.js';
import { HttpTarifaClient } from './clients/tarifa.client.js';
import { env } from './config/env.js';
import { ReservasScheduler } from './jobs/reservas.scheduler.js';
import { InMemoryReservaRepository } from './repositories/in-memory-reserva.repository.js';
import { ActivacionReservaService } from './services/activacion-reserva.service.js';
import { ReservaService } from './services/reserva.service.js';

const repository = new InMemoryReservaRepository();
const reservaService = new ReservaService(repository, new HttpTarifaClient(env.M7_URL));
const activacionService = new ActivacionReservaService(
  repository,
  new HttpDespachoClient(env.M5_URL),
);
const scheduler = new ReservasScheduler(
  repository,
  activacionService,
  env.RESERVATION_JOB_INTERVAL,
);
const app = createApp({ reservaService });

const server = app.listen(env.PORT, () => {
  console.log(`M9 – Reservas Programadas escuchando en el puerto ${env.PORT}.`);
});
scheduler.start();

const shutdown = (): void => {
  scheduler.stop();
  server.close();
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

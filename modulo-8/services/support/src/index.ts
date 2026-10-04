import { loadSupportConfig } from './config/env.js';
import { ticketRepository } from './models/ticket.model.js';
import { createSupportRuntime } from './support-runtime.js';

const config = loadSupportConfig();
const runtime = createSupportRuntime(config, ticketRepository);

runtime.app.listen(config.port, async () => {
  console.log(`[Server] Microservicio M8-Soporte ejecutándose en puerto ${config.port}`);

  await runtime.startLegacyEvents();
});

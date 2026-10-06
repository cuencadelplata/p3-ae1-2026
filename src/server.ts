import type { Server } from 'node:http';

import { createM8Application } from './app.js';

const configuredPort = Number(process.env.PORT);
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 3000;

async function bootstrap(): Promise<void> {
  const application = await createM8Application();
  const server = application.app.listen(port, () => {
    console.log(`[M8] Aplicación única escuchando en el puerto ${port}`);
  });

  registerShutdown(server, application.stop);
  application.start();
}

function registerShutdown(server: Server, stop: () => Promise<void>): void {
  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    console.log(`[M8] Cerrando aplicación única por ${signal}.`);
    server.close(() => {
      void stop().finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((error: unknown) => {
  console.error('[M8] No se pudo iniciar la aplicación única.', error);
  process.exit(1);
});

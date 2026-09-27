import { createApp } from './app';
import { env } from './config/env';
import { ensureStorage } from './repositories/receipt.repository';

async function bootstrap(): Promise<void> {
  await ensureStorage();

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.info(`[${env.serviceName}] escuchando en ${env.publicBaseUrl} (entorno: ${env.nodeEnv})`);
    console.info(`[${env.serviceName}] API disponible en ${env.publicBaseUrl}${env.apiPrefix}/receipts`);
    console.info(`[${env.serviceName}] comprobantes almacenados en ${env.storageDir}`);
  });

  const shutdown = (signal: string): void => {
    console.info(`[${env.serviceName}] senal ${signal} recibida, cerrando el servidor`);
    server.close((error) => {
      if (error) {
        console.error(`[${env.serviceName}] error al cerrar el servidor`, error);
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((error: unknown) => {
  console.error('No se pudo iniciar el servicio', error);
  process.exit(1);
});

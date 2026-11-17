import { createApp } from './app';
import { env } from './config/env';
import { createReceiptsModule } from './module';
import { createLogger, errorFields } from './observability/logger';

const log = createLogger('server');

/**
 * Arranque del servicio por separado. La aplicacion comun de M8 usa el mismo
 * modulo (createReceiptsModule) sin este servidor propio.
 */
function bootstrap(): void {
  const receipts = createReceiptsModule();
  const app = createApp({ checks: receipts.checks });

  // El servidor HTTP arranca antes que la base: asi /health responde aunque
  // PostgreSQL todavia no este disponible.
  const server = app.listen(env.port, () => {
    log('info', 'servicio iniciado', {
      url: env.publicBaseUrl,
      api: `${env.publicBaseUrl}${env.apiPrefix}/receipts`,
      environment: env.nodeEnv,
      version: env.serviceVersion,
    });
  });

  receipts.start();

  const shutdown = (signal: string): void => {
    log('info', 'cerrando el servidor', { signal });
    server.close((error) => {
      receipts
        .stop()
        .catch((closeError: unknown) => {
          log('error', 'error al liberar las conexiones', errorFields(closeError));
        })
        .finally(() => {
          if (error) {
            log('error', 'error al cerrar el servidor', errorFields(error));
            process.exit(1);
          }
          process.exit(0);
        });
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

try {
  bootstrap();
} catch (error) {
  log('error', 'no se pudo iniciar el servicio', errorFields(error));
  process.exit(1);
}

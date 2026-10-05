import { buildSupportFromEnv } from './support-runtime.js';

function start() {
  const support = buildSupportFromEnv();

  support.app.listen(support.config.port, async () => {
    console.log(`[Server] Microservicio M8-Soporte ejecutándose en puerto ${support.config.port}`);

    // En segundo plano: si la base todavía no está, Support atiende igual y
    // /health/ready informa unavailable hasta que las migraciones se apliquen.
    void support.database.prepare();
    await support.startLegacyEvents();
  });
}

try {
  start();
} catch (error) {
  console.error(`[Server] Support no puede arrancar: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

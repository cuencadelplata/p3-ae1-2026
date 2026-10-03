import { app } from './app.js';
import { testDbConnection, dbConfig } from './config/db.js';

const PORT = process.env.PORT || 3000;

// Red de seguridad (C9): desde Node 15 una promesa rechazada sin capturar termina el proceso.
// Un handler sin asyncHandler que falle (ej. DB caída) no debe tirar abajo toda la API.
process.on('unhandledRejection', (reason) => {
  console.error('[M2] Promesa rechazada sin capturar:', reason);
});

async function startServer() {
  console.log('----------------------------------------------------');
  console.log('🚀 Iniciando Módulo 2 - Servicio de Clientes (Grupo 5)');
  console.log('----------------------------------------------------');

  // Comprobar estado de PostgreSQL
  const dbOk = await testDbConnection();
  if (dbOk) {
    console.log(`✅ Base de datos conectada: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  } else {
    console.log('⚠️  Aviso: PostgreSQL no está activo aún (recuerda levantar con: docker compose up -d db-profiles)');
  }

  app.listen(PORT, () => {
    console.log(`🌐 Servidor Express escuchando en: http://localhost:${PORT}`);
    console.log(`📖 Documentación Interactiva Scalar: http://localhost:${PORT}/docs`);
    console.log(`🔍 Healthcheck: http://localhost:${PORT}/health`);
    console.log('----------------------------------------------------');
  });
}

startServer();

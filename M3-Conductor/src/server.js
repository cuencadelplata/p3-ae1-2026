//server.js
require("./instrumentation");
const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();
const { connectRabbitMQ } = require("./infraestructure/rabbimq.client");
const gateway = require("./infraestructure/messagingGateway");
const { startViajeFinalizadoConsumer } = require("./modules/valoraciones/consumers/viajeFinalizado.consumer");
const { startValoracionHabilitadaConsumer } = require("./modules/valoraciones/consumers/valoracionHabilitada.consumer");

const conductorRoutes = require("./routes/conductorRoutes");
const { seedRedisIfEmpty } = require("./repositories/redisRepository");
const rabbitmq = require("./config/rabbitmqClient");

const redis = require("./config/redisClient");

// Espera hasta 5 segundos a que Redis esté conectado.
function esperarRedis(ms = 5000) {
  if (redis.status === "ready") return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    redis.once("ready", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares globales
app.use(cors());
app.use(express.json());

// Servir frontend de pruebas desde /public
const publicPath = path.join(__dirname, "../public");
app.use(express.static(publicPath));

// Health check para Docker y monitoreo
app.get("/health", (_req, res) => {
  const messaging = gateway.status();
  res.status(200).json({
    status: messaging.circuit === "CLOSED" ? "ok" : "degraded",
    module: "M3-Conductor",
    timestamp: new Date().toISOString(),
    redis: process.env.REDIS_HOST ? `conectado a ${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}` : "local/mock",
    messaging
  });
});

// Rutas de la API montadas en /api /openapi.json
app.use("/api", conductorRoutes);

// Manejador para rutas no encontradas
app.use((_req, res) => {
  res.status(404).json({ error: "Ruta no encontrada en la API de Conductor & Valoraciones" });
});

// Iniciar servidor
app.listen(PORT, async () => {
  console.log(`====================================================`);
  console.log(`🚀 Servidor M3-Conductor corriendo:`);
  console.log(`   ➜ API:       http://localhost:${PORT}/api`);
  console.log(`   ➜ Frontend:  http://localhost:${PORT}`);
  console.log(`   ➜ Health:    http://localhost:${PORT}/health`);
  console.log(`   ➜ RabbitMQ:  http://localhost:${PORT}/rabbitmq`);
  console.log(`====================================================`);

  // Poblar datos mock en Redis, recién cuando la conexión está lista
  if (await esperarRedis()) {
    await seedRedisIfEmpty();
  } else {
    console.warn("[Redis] No se conectó a tiempo: no se sembraron los mocks.");
  }

  rabbitmq.getChannel().catch((err) => {
    console.warn(`[RabbitMQ] No disponible al iniciar (${err.message}). Se reintentará al publicar.`);
  });

  gateway.start({
    onRabbitReady: async () => {
      await connectRabbitMQ();
      await startViajeFinalizadoConsumer();
      await startValoracionHabilitadaConsumer();
    }
  });
});

module.exports = app;

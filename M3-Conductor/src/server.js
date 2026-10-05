//server.js
const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();
const { connectRabbitMQ } = require("./infraestructure/rabbimq.client");
const { startViajeFinalizadoConsumer } = require("./modules/valoraciones/consumers/viajeFinalizado.consumer");

const conductorRoutes = require("./routes/conductorRoutes");
const { seedRedisIfEmpty } = require("./repositories/redisRepository");

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
  res.status(200).json({
    status: "ok",
    module: "M3-Conductor",
    timestamp: new Date().toISOString(),
    redis: process.env.REDIS_HOST ? `conectado a ${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}` : "local/mock"
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

  // Poblar datos mock en Redis
  await seedRedisIfEmpty();
  try {
    await seedRedisIfEmpty();
    await connectRabbitMQ();
    await startViajeFinalizadoConsumer();
  } catch (error) {
    console.error("No se pudo iniciar Redis o RabbitMQ:", error.message);
  }
});

module.exports = app;

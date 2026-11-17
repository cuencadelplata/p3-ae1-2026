//server.js — OTel debe cargar antes que Express para instrumentar HTTP.
require("./instrumentation");

const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();
const { connectRabbitMQ } = require("./infraestructure/rabbimq.client");
const gateway = require("./infraestructure/messagingGateway");
const { startViajeFinalizadoConsumer } = require("./modules/valoraciones/consumers/viajeFinalizado.consumer");
const { startValoracionHabilitadaConsumer } = require("./modules/valoraciones/consumers/valoracionHabilitada.consumer");
const {
  requestMetrics,
  getSaturationSnapshot
} = require("./middleware/requestMetrics");

const conductorRoutes = require("./routes/conductorRoutes");
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

// Latencia + saturación (OTel) y log para Grafana/Loki.
app.use(requestMetrics);
app.use((req, res, next) => {
  const inicio = Date.now();
  res.on("finish", () => {
    if (req.originalUrl === "/health" || req.originalUrl.startsWith("/metrics")) {
      return;
    }
    console.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - inicio}ms`,
    );
  });
  next();
});

// Health check para Docker y monitoreo
app.get("/health", (_req, res) => {
  const messaging = gateway.status();
  res.status(200).json({
    status: messaging.circuit === "CLOSED" ? "ok" : "degraded",
    module: "M3-Conductor",
    timestamp: new Date().toISOString(),
    redis: process.env.REDIS_HOST ? `conectado a ${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}` : "local (fallback en memoria)",
    m1: process.env.M1_URL || "no configurado",
    messaging,
    saturation: getSaturationSnapshot()
  });
});

// Snapshot local de saturación / latencia reciente (sin Grafana)
app.get("/metrics/saturation", (_req, res) => {
  res.status(200).json({
    service: process.env.OTEL_SERVICE_NAME || "m3-conductor-service",
    timestamp: new Date().toISOString(),
    ...getSaturationSnapshot()
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

  // Sin datos mock: los conductores se crean vía POST /api/conductores con el userId de M1.
  if (!(await esperarRedis())) {
    console.warn("[Redis] No se conectó a tiempo: se opera con fallback a BD/memoria.");
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
import "./instrumentation.js";
import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "node:fs";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import { errorHandler } from "./middlewares/errorHandler.js";
import { vehiculoRoutes } from "./vehiculos/vehiculo-routes.js";
import { documentoRoutes } from "./documents/documents-routes.js";
import { connectRedis } from "./config/redisClient.js";
import { connectRabbit } from "./config/rabbitClient.js";
import { iniciarConsumidores as iniciarConsumidoresVehiculos } from "./events/consumers.js";
import { iniciarConsumidores as iniciarConsumidoresDocumentos } from "./documents/documents-consumers.js";

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 8083;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Log de cada request (para Grafana/Loki). Se omite /health porque el
// healthcheck de Docker lo llama cada 15 s y llenaría los logs de ruido.
app.use((req, res, next) => {
  const inicio = Date.now();
  res.on("finish", () => {
    if (req.originalUrl === "/health") return;
    console.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - inicio}ms`,
    );
  });
  next();
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "m3-drivers",
    timestamp: new Date().toISOString(),
  });
});

// Documentación interactiva de la API (Swagger UI), leída desde openapi.yaml
const openapiDoc = YAML.parse(fs.readFileSync("./openapi.yaml", "utf8"));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiDoc));

app.use("/api/v1/drivers/:driverId/vehicles", vehiculoRoutes);
app.use("/api/v1/drivers/:driverId/documents", documentoRoutes);

// Siempre al final, después de todas las rutas
app.use(errorHandler);

// Si Redis no está disponible, el servicio arranca igual (la idempotencia tolera el fallo).
// Sin await: con reconnectStrategy, connect() reintenta en segundo plano y no resuelve hasta conectar.
connectRedis()
  .then(() => console.log(" Conectado a Redis"))
  .catch((err) => console.warn("[redis] No disponible al arrancar, se continúa sin Redis:", err));

// Si RabbitMQ no está disponible, el servicio arranca igual: la publicación
// de eventos nunca bloquea la operación principal.
try {
  await connectRabbit();
  console.log(" Conectado a RabbitMQ");
  await iniciarConsumidoresVehiculos();
  await iniciarConsumidoresDocumentos();
} catch (err) {
  console.error("Error iniciando RabbitMQ o sus consumidores:", err);
}

app.listen(PORT, () => {
  console.log(`🚀 m3-drivers corriendo en http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Docs (Swagger UI): http://localhost:${PORT}/docs`);
});
import "dotenv/config";
import express from "express";
import { apiReference } from "@scalar/express-api-reference";
import { readFileSync, existsSync } from "fs";
import { parse } from "yaml";

import { config } from "./config";
import { inicializarBaseDatos } from "./infraestructura/basedatos";
import { conectarRedis, redisBreaker } from "./infraestructura/redis";
import { iniciarRabbit } from "./infraestructura/rabbit";
import { cargoCancelacionBreaker } from "./reintegro/cargoCancelacionClient";

// Importación de módulos de negocio (RF-7.1 al RF-7.7)
import estimacionTarifaRouter from "./estimacion-tarifa/estimacion-tarifa";
import rutaPago from "./metodo-pago/rutaPago";
import mockMercadoPagoAPI from "./mock/mercadoPagoAPI";
import cargoCancelacionRouter from "./cargo-cancelacion/cargo-cancelacion";
import rutaPagoDuplicado from "./pago-duplicado/rutaPagoDuplicado";
import rutaReintegro from "./reintegro/rutaReintegro";
import historialRouter, { historial } from "./historial-financiero/historial-financiero";

const app = express();
app.use(express.json());

// Documentación interactiva de la API (Scalar / OpenAPI)
if (existsSync("./openapi.yaml")) {
  try {
    const spec = parse(readFileSync("./openapi.yaml", "utf8"));
    app.use("/docs", apiReference({ content: spec }));
  } catch (err) {
    console.warn("[openapi] Error al cargar openapi.yaml:", (err as Error).message);
  }
}

app.get("/", (_req, res) => res.redirect("/docs"));

// Healthcheck con estado de los Circuit Breakers en tiempo real
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    servicio: "M7 - Tarifas, Pagos y Liquidaciones",
    circuitos: {
      redis: redisBreaker.getEstado(),
      cargoCancelacion: cargoCancelacionBreaker.getEstado(),
    },
    timestamp: new Date().toISOString(),
  });
});

// --- Registro de Rutas ---
// RF-7.1: Estimación de tarifas
app.use(estimacionTarifaRouter);

// RF-7.2 y RF-7.3: Métodos de pago y autorización (+ mock Mercado Pago)
app.use(rutaPago);
app.use(mockMercadoPagoAPI);

// RF-7.4: Cargo de cancelación
app.use(cargoCancelacionRouter);

// RF-7.5: Prevención de pago duplicado (idempotencia)
app.use(rutaPagoDuplicado);

// RF-7.6: Reintegro por viaje cancelado
app.use(rutaReintegro);

// RF-7.7: Historial financiero
app.use(historialRouter);

// --- Función Principal de Arranque con Conexión a Backing Services ---
async function main() {
  console.log("=================================================");
  console.log("   M7: Tarifas, Pagos y Liquidaciones - AE2      ");
  console.log("=================================================");

  // 1. Inicializar base de datos (PostgreSQL)
  console.log("[inicio] Conectando a Base de Datos...");
  await inicializarBaseDatos();
  await historial.initialize();

  // 2. Conectar a Redis (con Circuit Breaker)
  console.log("[inicio] Conectando a Redis...");
  await conectarRedis();

  // 3. Conectar a RabbitMQ (topología y consumer de eventos)
  console.log("[inicio] Conectando a RabbitMQ...");
  await iniciarRabbit();

  // 4. Iniciar escucha del servidor HTTP
  app.listen(config.port, () => {
    console.log(`[servidor] M7 corriendo en el puerto ${config.port}`);
    console.log(`[servidor] Documentación OpenAPI en: http://localhost:${config.port}/docs`);
    console.log(`[servidor] Estado de salud y Circuit Breakers en: http://localhost:${config.port}/health`);
  });
}

main().catch((e) => {
  console.error("[servidor] Fallo crítico al iniciar:", e);
  process.exit(1);
});

export default app;

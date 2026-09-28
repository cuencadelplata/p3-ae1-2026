import express from "express";
import { apiReference } from "@scalar/express-api-reference";
import { readFileSync } from "fs";
import { parse } from "yaml";

import { config } from "./config";
import { conectarRedis } from "./infraestructura/redis";
import { iniciarRabbit } from "./infraestructura/rabbit";
import { iniciarConsumerViajeCancelado } from "./6-reintegro/consumerViajeCancelado";
import rutaReintegro from "./6-reintegro/rutaReintegro";
import rutaPagoDuplicado from "./5-pago-duplicado/rutaPagoDuplicado";
import rutaPago from "./metodo-pago/rutaPago";

const app = express();
app.use(express.json());

app.use("/docs", apiReference({ content: parse(readFileSync("./openapi.yaml", "utf8")) }));
app.get("/", (_req, res) => res.redirect("/docs"));
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use(rutaPago);
app.use(rutaReintegro);
app.use(rutaPagoDuplicado);

async function main() {
  await conectarRedis();
  console.log("Redis conectado");

  const canal = await iniciarRabbit();
  await iniciarConsumerViajeCancelado(canal);
  console.log("RabbitMQ conectado, escuchando viaje.cancelado");

  app.listen(config.port, () => {
    console.log(`M7 corriendo en el puerto ${config.port}`);
    console.log(`Documentación disponible en http://localhost:${config.port}/docs`);
  });
}

main().catch((e) => {
  console.error("Fallo al iniciar:", e);
  process.exit(1);
});
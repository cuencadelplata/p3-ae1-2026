import express from "express";
import { apiReference } from "@scalar/express-api-reference";
import { readFileSync } from "fs";
import { parse } from "yaml";

import { config } from "./config";
import { conectarRedis } from "./infraestructura/redis";
import { iniciarRabbit } from "./infraestructura/rabbit";
import { registry } from "./infraestructura/metricas";

import estimacionTarifaRouter from "./Lautaro/estimacion-tarifa/estimacion-tarifa";
import rutaPago from "./Matilda/metodo-pago/rutaPago";
import cargoCancelacionRouter from "./Lautaro/cargo-cancelacion/cargo-cancelacion";
import rutaPagoDuplicado from "./Aylen/pago-duplicado/rutaPagoDuplicado";
import rutaReintegro from "./Aylen/reintegro/rutaReintegro";
import historialRouter from "./Lautaro/historial-financiero/historial-financiero";

const app = express();
app.use(express.json());

app.use("/docs", apiReference({ content: parse(readFileSync("./openapi.yaml", "utf8")) }));
app.get("/", (_req, res) => res.redirect("/docs"));
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", registry.contentType);
  res.end(await registry.metrics());
});

app.use(estimacionTarifaRouter);
app.use(rutaPago);
app.use(cargoCancelacionRouter);
app.use(rutaPagoDuplicado);
app.use(rutaReintegro);
app.use(historialRouter);

async function main() {
  await conectarRedis();
  console.log("Redis conectado");
  await iniciarRabbit();
  app.listen(config.port, () => {
    console.log(`M7 corriendo en el puerto ${config.port}`);
    console.log(`Documentacion disponible en http://localhost:${config.port}/docs`);
  });
}

main().catch((e) => {
  console.error("Fallo al iniciar:", e);
  process.exit(1);
});
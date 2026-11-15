import express from "express";
import { apiReference } from "@scalar/express-api-reference";
import { readFileSync } from "fs";
import { parse } from "yaml";

import { config } from "./config";
import { conectarRedis } from "./infraestructura/redis";
import { iniciarRabbit } from "./infraestructura/rabbit";
import rutaPagoDuplicado from "./5-pago-duplicado/rutaPagoDuplicado";

const app = express();
app.use(express.json());

app.use("/docs", apiReference({ content: parse(readFileSync("./openapi.yaml", "utf8")) }));
app.get("/", (_req, res) => res.redirect("/docs"));
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use(rutaPagoDuplicado);

async function main() {
  await conectarRedis();
  console.log("Redis conectado");

  await iniciarRabbit(); // ahora arma el canal, la topología y el consumer internamente

  app.listen(config.port, () => {
    console.log(`M7 corriendo en el puerto ${config.port}`);
    console.log(`Documentación disponible en http://localhost:${config.port}/docs`);
  });
}

main().catch((e) => {
  console.error("Fallo al iniciar:", e);
  process.exit(1);
});
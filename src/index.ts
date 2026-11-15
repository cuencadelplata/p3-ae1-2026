import express from "express";
import { apiReference } from "@scalar/express-api-reference";
import { readFileSync } from "fs";
import { parse } from "yaml";

import { config } from "./config";
import { conectarRedis } from "./infraestructura/redis";
import { iniciarRabbit } from "./infraestructura/rabbit";
import { pool } from "./infraestructura/basedatos";
import { cargoCancelacionBreaker } from "./Aylen/reintegro/obtenerCargo";

import estimacionTarifaRouter from "./Lautaro/estimacion-tarifa/estimacion-tarifa";
import rutaPago from "./Matilda/metodo-pago/rutaPago";
import mockMercadoPagoAPI from "./Matilda/mock/mercadoPagoAPI";
import cargoCancelacionRouter from "./Lautaro/cargo-cancelacion/cargo-cancelacion";
import rutaPagoDuplicado from "./Aylen/pago-duplicado/rutaPagoDuplicado";
import historialRouter, { historial } from "./Lautaro/historial-financiero/historial-financiero";

const app = express();
app.use(express.json());

app.use("/docs", apiReference({ content: parse(readFileSync("./openapi.yaml", "utf8")) }));
app.get("/", (_req, res) => res.redirect("/docs"));
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use(estimacionTarifaRouter);
app.use(rutaPago);
app.use(mockMercadoPagoAPI);
app.use(cargoCancelacionRouter);
app.use(rutaPagoDuplicado);
app.use(historialRouter);

async function inicializarBD() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reintegros (
      id                SERIAL PRIMARY KEY,
      id_orden          TEXT NOT NULL UNIQUE,
      viaje_id          TEXT NOT NULL,
      monto_cancelacion NUMERIC(12,2) NOT NULL,
      monto_reintegro   NUMERIC(12,2) NOT NULL,
      creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function main() {
  await conectarRedis();
  console.log("Redis conectado");

  await inicializarBD();
  console.log("Base de datos inicializada");

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

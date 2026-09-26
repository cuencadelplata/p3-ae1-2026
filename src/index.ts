import express from "express";
import { apiReference } from "@scalar/express-api-reference";
import { readFileSync } from "fs";
import { parse } from "yaml";

import { estimarTarifaHandler } from "./estimacion-tarifa.js";
import { calcularCargoCancelacionHandler } from "./cargo-cancelacion.js";
import { historial, historialRouter } from "./historial-financiero.js";

const app = express();
app.use(express.json());

// --- Documentación combinada (OpenAPI) ---
const historialDoc = parse(readFileSync("./openapi.yaml", "utf8"));
const cargoCancelacionDoc = parse(readFileSync("./openApi-Cancelacion.yaml", "utf8"));

const combinedDoc = {
  openapi: "3.0.3",
  info: { title: "M7 - Tarifas, Pagos y Liquidaciones", version: "1.0.0" },
  paths: {
    ...historialDoc.paths,
    ...cargoCancelacionDoc.paths,
  },
  components: {
    schemas: {
      ...(historialDoc.components?.schemas ?? {}),
      ...(cargoCancelacionDoc.components?.schemas ?? {}),
    },
  },
};

app.use("/docs", apiReference({ content: combinedDoc }));

app.get("/", (_req, res) => {
  res.redirect("/docs");
});

// --- Rutas de cada RF ---
app.post("/tarifas/estimacion", estimarTarifaHandler);
app.post("/tarifas/cancelacion", calcularCargoCancelacionHandler);
app.use(historialRouter);

// --- Arranque ---
await historial.initialize();

app.listen(3000, () => {
  console.log("Servidor escuchando en el puerto 3000");
});
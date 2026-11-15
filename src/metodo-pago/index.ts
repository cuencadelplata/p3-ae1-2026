import express from "express";
import { apiReference } from "@scalar/express-api-reference";
import rutaReintegro from "./6-reintegro/rutaReintegro.js";
import rutaPagoDuplicado from "./5-pago-duplicado/rutaPagoDuplicado.js";
import rutaPago from "./metodo-pago/rutaPago.js";
import mercadoPagoAPI from "./mock/mercadoPagoAPI.js";
import { estimarTarifaHandler } from "./estimacion-tarifa.js";
import { calcularCargoCancelacionHandler } from "./cargo-cancelacion.js";
import { historialRouter, historial } from "./historial-financiero.js";

const app = express();
app.use(express.json());
app.use(express.static("."));

app.use(
  "/docs",
  apiReference({
    spec: { url: "/openapi.yaml" },
  })
);

// Tus rutas
app.use(rutaReintegro);
app.use(rutaPagoDuplicado);
app.use(rutaPago);
app.use(mockMercadoPagoApi);

// Rutas del otro subgrupo
app.post("/tarifas/estimacion", estimarTarifaHandler);
app.post("/tarifas/cancelacion", calcularCargoCancelacionHandler);
app.use(historialRouter);

const PUERTO = 3000;

(async () => {
  await historial.initialize();
  app.listen(PUERTO, () => {
    console.log(`M7 corriendo en el puerto ${PUERTO}`);
    console.log(`Documentación disponible en http://localhost:${PUERTO}/docs`);
  });
})();
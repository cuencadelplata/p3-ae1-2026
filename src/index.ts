import express from "express";
import { apiReference } from "@scalar/express-api-reference";
import rutaReintegro from "./6-reintegro/rutaReintegro";
import rutaPagoDuplicado from "./5-pago-duplicado/rutaPagoDuplicado";
import rutaPago from "./metodo-pago/rutaPago";
import { estimarTarifaHandler } from "./estimacion-tarifa";
import { calcularCargoCancelacionHandler } from "./cargo-cancelacion";
import { historialRouter, historial } from "./historial-financiero";

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

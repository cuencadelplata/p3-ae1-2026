import express from "express";
import { apiReference } from "@scalar/express-api-reference";
import rutaReintegro from "./6-reintegro/rutaReintegro";
import rutaPagoDuplicado from "./5-pago-duplicado/rutaPagoDuplicado";
import rutaPago from "./metodo-pago/rutaPago";

const app = express();
app.use(express.json());

app.use(express.static("."));

app.use(
  "/docs",
  apiReference({
    spec: {
      url: "/openapi.yaml",
    },
  })
);

app.use(rutaReintegro);
app.use(rutaPagoDuplicado);
app.use(rutaPago);

const PUERTO = 3000;
app.listen(PUERTO, () => {
  console.log(`M7 corriendo en el puerto ${PUERTO}`);
  console.log(`Documentación disponible en http://localhost:${PUERTO}/docs`);
});
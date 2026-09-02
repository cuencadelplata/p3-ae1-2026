import express from "express";
import rutaReintegro from "./6-reintegro/rutaReintegro";
import rutaPagoDuplicado from "./5-pago-duplicado/rutaPagoDuplicado";

const app = express();
app.use(express.json());

app.use(rutaReintegro);
app.use(rutaPagoDuplicado);

const PUERTO = 3000;
app.listen(PUERTO, () => {
  console.log(`M7 corriendo en el puerto ${PUERTO}`);
});
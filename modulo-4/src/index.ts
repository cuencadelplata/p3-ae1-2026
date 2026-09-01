import { app } from './app.js';

const port = Number(process.env.PORT ?? 3004);

app.listen(port, () => {
  console.log(`[M4 Ubicacion y Disponibilidad] Servicio en http://localhost:${port}`);
  console.log(`[M4] OpenAPI disponible en http://localhost:${port}/openapi/openapi-m4.yaml`);
});

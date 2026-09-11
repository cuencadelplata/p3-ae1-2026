import { app } from './app.js';

const port = Number(process.env.PORT ?? 3004);

app.listen(port, () => {
  console.log(`[M4 Ubicacion y Disponibilidad] Servicio en http://localhost:${port}`);
  console.log(`[M4] Documentacion Scalar en http://localhost:${port}/docs`);
  console.log('[M4] La interfaz grafica se ejecuta como una aplicacion independiente');
});

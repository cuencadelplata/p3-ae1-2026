import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { errorHandler } from "./middlewares/errorHandler.js";
import { vehiculoRouter } from "./vehiculos/vehiculo-router.js";
import { documentoRouter } from "./documents/documento-router.js";

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 8083;

app.use(cors());
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "m3-drivers",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/v1/drivers/:driverId/vehicles", vehiculoRouter);
app.use("/api/v1/drivers/:driverId/documents", documentoRouter);

// Siempre al final, después de todas las rutas
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 m3-drivers corriendo en http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
});


// TODO: montar acá los routers cuando existan
// app.use("/api/v1/drivers/:driverId/vehicles", vehiculoRouter);
// app.use("/api/v1/drivers/:driverId/documents", documentoRouter);

// no usamos errorhandler al final (osi?)
//app.use(errorHandler);

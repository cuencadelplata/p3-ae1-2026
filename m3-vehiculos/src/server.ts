import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "node:fs";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import { errorHandler } from "./middlewares/errorHandler.js";
import { vehiculoRoutes } from "./vehiculos/vehiculo-routes.js";
import { documentoRoutes } from "./documents/documents-routes.js";

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

// Documentación interactiva de la API (Swagger UI), leída desde openapi.yaml
const openapiDoc = YAML.parse(fs.readFileSync("./openapi.yaml", "utf8"));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiDoc));

app.use("/api/v1/drivers/:driverId/vehicles", vehiculoRoutes);
app.use("/api/v1/drivers/:driverId/documents", documentoRoutes);

// Siempre al final, después de todas las rutas
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 m3-drivers corriendo en http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Docs (Swagger UI): http://localhost:${PORT}/docs`);
});

// TODO: montar acá los Routess cuando existan
// app.use("/api/v1/drivers/:driverId/vehicles", vehiculoroutes);
// app.use("/api/v1/drivers/:driverId/documents", documentoRouter);

// no usamos errorhandler al final (osi?)
//app.use(errorHandler);

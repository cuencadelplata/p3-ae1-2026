import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 8083;

app.use(cors());
app.use(express.json());

// Health check — confirma que el server y las env vars están OK
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "m3-drivers",
    timestamp: new Date().toISOString(),
  });
});

// TODO: montar acá los routers cuando existan
// app.use("/api/v1/drivers/:driverId/vehicles", vehiculoRouter);
// app.use("/api/v1/drivers/:driverId/documents", documentoRouter);

// no usamos errorhandler al final (osi?)
//app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 m3-drivers corriendo en http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
});

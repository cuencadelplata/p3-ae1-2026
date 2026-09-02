import express from "express";
import path from "path";
import fs from "fs";
import YAML from "yaml";
import swaggerUi from "swagger-ui-express";
import { cancellationRouter } from "./routes/cancellation.routes";

export const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "M7-cargo-cancelacion" });
});

app.use("/api/m7", cancellationRouter);

// Documentacion OpenAPI (Swagger UI) - RF-7.4
const openapiPath = path.join(__dirname, "../../openapi.yaml");
const openapiDocument = YAML.parse(fs.readFileSync(openapiPath, "utf8"));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));
app.get("/openapi.json", (_req, res) => res.json(openapiDocument));

const PORT = Number(process.env.PORT ?? 3007);

export function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`[M7 - Tarifas/Pagos] RF-7.4 Cargo de cancelacion escuchando en :${port}`);
    console.log(`Documentacion OpenAPI (Swagger UI) disponible en :${port}/docs`);
  });
}

if (require.main === module) {
  startServer();
}
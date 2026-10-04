import "dotenv/config";
import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import authRoutes from "./routes/auth.routes";

const app = express();

// Solo si la API corre detrás de un proxy (nginx, gateway) que agrega X-Forwarded-For.
// Si se activa sin proxy, un cliente podría falsificar su IP y saltearse el rate limit.
if (process.env.TRUST_PROXY === "true") {
    app.set("trust proxy", true);
}

const openapiPath = path.join(
    process.cwd(),
    "openapi.yaml"
);

const openapiDocument = YAML.parse(
    fs.readFileSync(openapiPath, "utf8")
);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
    return res.status(200).json({
        status: "OK",
        modulo: "M1 - Identidad y Acceso"
    });
});

app.get("/openapi.yaml", (_req, res) => {
    return res.sendFile(openapiPath);
});

app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(openapiDocument, {
        customSiteTitle: "M1 - Identidad y Acceso"
    })
);

app.use("/auth", authRoutes);

export default app;
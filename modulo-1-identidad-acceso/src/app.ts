import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
    return res.status(200).json({
        status: "OK",
        modulo: "M1 - Identidad y Acceso"
    });
});

app.use("/auth", authRoutes);

export default app;
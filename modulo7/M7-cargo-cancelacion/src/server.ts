import express from "express";
import { cancellationRouter } from "./routes/cancellation.routes";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "M7-cargo-cancelacion" });
});

app.use("/api/m7", cancellationRouter);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3007;

app.listen(PORT, () => {
  console.log(`[M7 - Tarifas/Pagos] RF-7.4 Cargo de cancelacion escuchando en :${PORT}`);
});
type OperationStatus = "pending" | "completed" | "failed" | "cancelled";
type OperationType = "payment" | "refund" | "transfer" | "payout";
interface FinancialOperation {
  id: string;
  type: OperationType;
  amount: number;
  status: OperationStatus;
  createdAt: string;
}
class FinancialHistory {
  private operation: FinancialOperation[] = [];
  registerOperation(operation: FinancialOperation): void {
    this.operation.push(operation);
  }
  getHistory(): FinancialOperation[] {
    return this.operation;
  }
  updateStatus(id: string, newStatus: OperationStatus): FinancialOperation {
    const operationBuscada = this.operation.find(op => op.id === id);
    if (operationBuscada === undefined) {
      throw new Error(`Operation with id ${id} not found`);
    }
    operationBuscada.status = newStatus;
    return operationBuscada;
  }
}
import express from "express";
import { apiReference } from "@scalar/express-api-reference";
import rutaReintegro from "./6-reintegro/rutaReintegro";
import rutaPagoDuplicado from "./5-pago-duplicado/rutaPagoDuplicado";
import rutaPago from "./metodo-pago/rutaPago";
const app = express();
app.use(express.json());
app.use(express.static("."));
app.use(
  "/docs",
  apiReference({
    spec: {
      url: "/openapi.yaml",
    },
  })
);
app.use(rutaReintegro);
app.use(rutaPagoDuplicado);
app.use(rutaPago);
const historial = new FinancialHistory();
app.get("/operations", (req, res) => {
  res.json(historial.getHistory());
});
app.post("/operations", (req, res) => {
  if (typeof req.body.amount !== "number"){
    res.status(400).json({ error: "El campo amount debe ser un número" });
    return; 
    }
    if (
  req.body.type !== "payment" && req.body.type !== "refund" && req.body.type !== "transfer" && req.body.type !== "payout") {
  res.status(400).json({ error: "El campo type no es válido" });
    return;
}
    const { type, amount } = req.body;
    
  historial.registerOperation({
    id: `op_${Date.now()}`,
    type,
    amount,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  res.status(201).json({ mensaje: "Operación creada" });
});
app.patch("/operations/:id/status", (req, res) => {
  const id = req.params.id;
  const newStatus = req.body.status;
  const existe = historial.getHistory().find(op => op.id === id);
  if (existe === undefined) {
    res.status(404).json({ error: "Operación no encontrada" });
    return;
  }
  if (newStatus !== "pending" && newStatus !== "completed" && newStatus !== "failed" && newStatus !== "cancelled") {
    res.status(400).json({ error: "El nuevo estado no es válido" });
    return;
  }
  const actualizada = historial.updateStatus(id, newStatus);
  res.json(actualizada);
});
app.listen(3000, () => {
  console.log("Servidor escuchando en el puerto 3000");
});
import { Router } from "express";
import { supabase } from "../../supabaseClient";

export type OperationStatus = "pending" | "completed" | "failed" | "cancelled";
export type OperationType = "payment" | "refund" | "transfer" | "payout";

export interface FinancialOperation {
  id: string;
  type: OperationType;
  amount: number;
  status: OperationStatus;
  createdAt: string;
}

export class FinancialHistory {
  private memoryOperations: FinancialOperation[] = [];

  async initialize(): Promise<void> {
    // Supabase — la tabla ya existe en el proyecto
  }

  async registerOperation(operation: FinancialOperation): Promise<void> {
    const { error } = await supabase.from("financial_operations").insert({
      id: operation.id,
      type: operation.type,
      amount: operation.amount,
      status: operation.status,
      created_at: operation.createdAt,
    });
    if (error) {
      // fallback a memoria si Supabase falla
      this.memoryOperations.push(operation);
    }
  }

  async getHistory(): Promise<FinancialOperation[]> {
    const { data, error } = await supabase
      .from("financial_operations")
      .select("id, type, amount, status, created_at")
      .order("created_at", { ascending: true });

    if (error || !data) return this.memoryOperations;

    return data.map((row) => ({
      id: row.id,
      type: row.type as OperationType,
      amount: Number(row.amount),
      status: row.status as OperationStatus,
      createdAt: row.created_at,
    }));
  }

  async updateStatus(id: string, newStatus: OperationStatus): Promise<FinancialOperation | undefined> {
    const { data, error } = await supabase
      .from("financial_operations")
      .update({ status: newStatus })
      .eq("id", id)
      .select("id, type, amount, status, created_at")
      .maybeSingle();

    if (error || !data) {
      const op = this.memoryOperations.find((item) => item.id === id);
      if (!op) return undefined;
      op.status = newStatus;
      return op;
    }

    return {
      id: data.id,
      type: data.type as OperationType,
      amount: Number(data.amount),
      status: data.status as OperationStatus,
      createdAt: data.created_at,
    };
  }

  async exists(id: string): Promise<boolean> {
    const { data, error } = await supabase
      .from("financial_operations")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (error) return this.memoryOperations.some((op) => op.id === id);
    return data !== null;
  }
}

export const historial = new FinancialHistory();
export const historialRouter = Router();

historialRouter.get("/operations", async (_req, res) => {
  res.json(await historial.getHistory());
});

historialRouter.post("/operations", async (req, res) => {
  if (typeof req.body.amount !== "number") {
    res.status(400).json({ error: "El campo amount debe ser un número" });
    return;
  }
  if (
    req.body.type !== "payment" &&
    req.body.type !== "refund" &&
    req.body.type !== "transfer" &&
    req.body.type !== "payout"
  ) {
    res.status(400).json({ error: "El campo type no es válido" });
    return;
  }

  const { type, amount } = req.body;
  await historial.registerOperation({
    id: `op_${Date.now()}`,
    type,
    amount,
    status: "pending",
    createdAt: new Date().toISOString(),
  });

  res.status(201).json({ mensaje: "Operación creada" });
});

historialRouter.patch("/operations/:id/status", async (req, res) => {
  const id = req.params.id;
  const newStatus = req.body.status;

  if (!(await historial.exists(id))) {
    res.status(404).json({ error: "Operación no encontrada" });
    return;
  }
  if (
    newStatus !== "pending" &&
    newStatus !== "completed" &&
    newStatus !== "failed" &&
    newStatus !== "cancelled"
  ) {
    res.status(400).json({ error: "El nuevo estado no es válido" });
    return;
  }

  const actualizada = await historial.updateStatus(id, newStatus);
  if (actualizada === undefined) {
    res.status(404).json({ error: "Operación no encontrada" });
    return;
  }
  res.json(actualizada);
});

export default historialRouter;
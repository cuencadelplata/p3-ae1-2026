import { Router } from "express";
import { pool } from "../infraestructura/basedatos";

export type OperationStatus = "pending" | "completed" | "failed" | "cancelled";
export type OperationType = "payment" | "refund" | "transfer" | "payout";

export interface FinancialOperation {
  id: string;
  type: OperationType;
  amount: number;
  status: OperationStatus;
  createdAt: string;
}

type OperationRow = {
  id: string;
  type: OperationType;
  amount: string;
  status: OperationStatus;
  created_at: Date;
};

export class FinancialHistory {
  private memoryOperations: FinancialOperation[] = [];

  async initialize(): Promise<void> {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS financial_operations (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK (type IN ('payment', 'refund', 'transfer', 'payout')),
          amount NUMERIC NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
          created_at TIMESTAMPTZ NOT NULL
        )
      `);
    } catch {
      // Si la BD no está disponible, funciona en memoria
    }
  }

  async registerOperation(operation: FinancialOperation): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO financial_operations (id, type, amount, status, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [operation.id, operation.type, operation.amount, operation.status, operation.createdAt]
      );
      return;
    } catch {
      this.memoryOperations.push(operation);
    }
  }

  async getHistory(): Promise<FinancialOperation[]> {
    try {
      const result = await pool.query<OperationRow>(
        `SELECT id, type, amount, status, created_at
         FROM financial_operations
         ORDER BY created_at ASC`
      );
      return result.rows.map((row) => ({
        id: row.id,
        type: row.type,
        amount: Number(row.amount),
        status: row.status,
        createdAt: row.created_at.toISOString(),
      }));
    } catch {
      return this.memoryOperations;
    }
  }

  async updateStatus(id: string, newStatus: OperationStatus): Promise<FinancialOperation | undefined> {
    try {
      const result = await pool.query<OperationRow>(
        `UPDATE financial_operations
         SET status = $2
         WHERE id = $1
         RETURNING id, type, amount, status, created_at`,
        [id, newStatus]
      );
      const row = result.rows[0];
      return row === undefined ? undefined : this.fromRow(row);
    } catch {
      const op = this.memoryOperations.find((item) => item.id === id);
      if (!op) return undefined;
      op.status = newStatus;
      return op;
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      const result = await pool.query("SELECT 1 FROM financial_operations WHERE id = $1", [id]);
      return (result.rowCount ?? 0) > 0;
    } catch {
      return this.memoryOperations.some((op) => op.id === id);
    }
  }

  private fromRow(row: OperationRow): FinancialOperation {
    return {
      id: row.id,
      type: row.type,
      amount: Number(row.amount),
      status: row.status,
      createdAt: row.created_at.toISOString(),
    };
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

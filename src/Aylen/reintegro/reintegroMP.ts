import { config } from "../../config";

export interface ResultadoReintegroMP {
  refundId: string;
  estado: string;
  monto: number;
}

export async function ejecutarReintegroMP(
  paymentId: string,
  monto?: number
): Promise<ResultadoReintegroMP> {
  const response = await fetch(
    `${config.mpBaseUrl}/v1/payments/${paymentId}/refunds`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.mpAccessToken}`,
      },
      body: monto !== undefined ? JSON.stringify({ amount: monto }) : "{}",
      signal: AbortSignal.timeout(10_000),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`MP refund error ${response.status}: ${data.message ?? "sin detalle"}`);
  }

  return {
    refundId: String(data.id),
    estado: data.status ?? "unknown",
    monto: data.amount ?? monto ?? 0,
  };
}
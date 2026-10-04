import { config } from "../config";

export interface ResultadoPagoMP {
  paymentId: string;
  status: "approved" | "rejected";
}

export async function procesarPagoMercadoPago(
  viajeId: string,
  total: number
): Promise<ResultadoPagoMP> {
  const baseUrl = process.env.MP_MOCK_URL ?? `http://localhost:${config.port}`;

  const response = await fetch(`${baseUrl}/mock-mercadopago/v1/payments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viajeId, total }),
  });

  if (!response.ok) {
    throw new Error(`Mercado Pago (mock) respondió ${response.status}`);
  }

  const data = (await response.json()) as any;

  return {
    paymentId: data.id,
    status: data.status,
  };
}

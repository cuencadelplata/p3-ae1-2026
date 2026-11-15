export interface ResultadoPagoMP {
  paymentId: string;
  status: "approved" | "rejected";
}

const MP_BASE_URL = process.env.MP_MOCK_URL ?? "http://localhost:3000";

// Llama al mock
export async function procesarPagoMercadoPago(
  viajeId: string,
  total: number
): Promise<ResultadoPagoMP> {
  const response = await fetch(`${MP_BASE_URL}/mock-mercadopago/v1/payments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viajeId, total }),
  });

  if (!response.ok) {
    throw new Error(`Mercado Pago (mock) respondió ${response.status}`);
  }

  const data = await response.json();

  return {
    paymentId: data.id,
    status: data.status,
  };
}
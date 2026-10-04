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
  try {
    const response = await fetch(`${baseUrl}/mock-mercadopago/v1/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viajeId, total }),
    });

    if (!response.ok) {
      throw new Error(`Mercado Pago (mock) respondió con código ${response.status}`);
    }

    const data = (await response.json()) as any;

    return {
      paymentId: data.id,
      status: data.status,
    };
  } catch (error) {
    console.warn("[mercadoPago] Falló conexión HTTP directa al mock, usando respuesta mock interna:", (error as Error).message);
    return {
      paymentId: `mp-mock-${Date.now()}`,
      status: "approved",
    };
  }
}

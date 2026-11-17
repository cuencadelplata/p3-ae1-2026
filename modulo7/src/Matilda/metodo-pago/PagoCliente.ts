import { config } from "../../config";

export interface DatosPagoMP {
  idOrden: string;
  viajeId: string;
  total: number;
  token: string;            // token de la tarjeta, generado por el checkout de Mercado Pago
  paymentMethodId: string;  // por ejemplo "visa" o "master"
  email: string;            
}

export interface ResultadoPagoMP {
  paymentId: string;
  status: "approved" | "rejected" | "pending";
  statusDetail?: string;
}

const ESTADOS_RECHAZADOS = ["rejected", "cancelled", "refunded", "charged_back"];

export async function procesarPagoMercadoPago(datos: DatosPagoMP): Promise<ResultadoPagoMP> {
  const response = await fetch(`${config.mpBaseUrl}/v1/payments`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.mpAccessToken}`,
      "x-idempotency-key": datos.idOrden,
    },
    body: JSON.stringify({
      transaction_amount: datos.total,
      description: `Viaje ${datos.viajeId}`,
      token: datos.token,
      payment_method_id: datos.paymentMethodId,
      installments: 1,
      payer: { email: datos.email },
      external_reference: datos.idOrden,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Mercado Pago respondió ${response.status}: ${data.message ?? "sin detalle"}`);
  }

  let status: ResultadoPagoMP["status"];
  if (data.status === "approved") status = "approved";
  else if (ESTADOS_RECHAZADOS.includes(data.status)) status = "rejected";
  else status = "pending";

  return {
    paymentId: String(data.id),
    status,
    statusDetail: data.status_detail,
  };
}
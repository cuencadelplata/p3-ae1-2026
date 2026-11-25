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

const ESTADOS_RECHAZADOS = ["rejected", "cancelled"];

export async function confirmarRechazoMercadoPago(idOrden: string): Promise<boolean> {
  const params = new URLSearchParams({
    external_reference: idOrden, sort: "date_created", criteria: "desc", limit: "1",
  });
  const response = await fetch(`${config.mpBaseUrl}/v1/payments/search?${params}`, {
    headers: { authorization: `Bearer ${config.mpAccessToken}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("No se pudo verificar el rechazo en Mercado Pago");

  const { paging, results } = await response.json();
  // Un resultado vacío puede deberse a demora en la indexación. Hace falta un
  // rechazo explícito de la única orden que usa M6 para el viaje.
  return paging?.total === 1 && results?.length === 1 &&
    results[0].external_reference === idOrden && ESTADOS_RECHAZADOS.includes(results[0].status);
}

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

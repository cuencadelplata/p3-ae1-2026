import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { procesarPagoMercadoPago } from "../Matilda/metodo-pago/PagoCliente";
const fetchOriginal = globalThis.fetch;

describe("procesarPagoMercadoPago (cliente del mock de Mercado Pago)", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it("devuelve paymentId y status cuando el mock aprueba el pago", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "mp-mock-abc", status: "approved", transaction_amount: 2000 }),
    });

        const resultado = await procesarPagoMercadoPago({ idOrden: "orden-1", viajeId: "viaje-1", total: 2000, token: "tok", paymentMethodId: "visa", email: "a@b.com" });
    expect(resultado.paymentId).toBe("mp-mock-abc");
    expect(resultado.status).toBe("approved");
  });

  it("lanza error si la respuesta del mock no es ok", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

        await expect(procesarPagoMercadoPago({ idOrden: "orden-2", viajeId: "viaje-2", total: 1000, token: "tok", paymentMethodId: "visa", email: "a@b.com" })).rejects.toThrow(
      "Mercado Pago respondió 500"
    );
  });
});
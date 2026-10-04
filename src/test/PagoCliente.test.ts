import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { procesarPagoMercadoPago } from "../metodo-pago/PagoCliente";

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

    const resultado = await procesarPagoMercadoPago("viaje-1", 2000);

    expect(resultado.paymentId).toBe("mp-mock-abc");
    expect(resultado.status).toBe("approved");
  });

  it("lanza error si la respuesta del mock no es ok", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(procesarPagoMercadoPago("viaje-2", 1000)).rejects.toThrow(
      "Mercado Pago (mock) respondió 500"
    );
  });
});
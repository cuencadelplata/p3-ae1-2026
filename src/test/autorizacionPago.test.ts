import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../supabaseClient", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { supabase } from "../supabaseClient";
import { autorizarPago, rechazarPago } from "../metodo-pago/procesoPago";

let builder: any;

function filaPago(overrides: Record<string, any> = {}) {
  return {
    pago_Id: "pago-test",
    cliente_Id: "cliente1",
    viaje_Id: "viaje-test",
    tipo: "efectivo",
    detalle: "",
    fecha: new Date().toISOString(),
    estado: "pendiente",
    paymentId: null,
    total: null,
    moneda: null,
    ...overrides,
  };
}

beforeEach(() => {
  builder = {
    update: vi.fn(() => builder),
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  };
  (supabase.from as any).mockReturnValue(builder);
});

describe("autorizarPago (RF-7.3 - Autorización/captura)", () => {
  it("autoriza un pago pendiente", async () => {
    builder.maybeSingle.mockResolvedValueOnce({
      data: filaPago({ viaje_Id: "viaje-autorizado" }),
      error: null,
    });
    builder.single.mockResolvedValueOnce({
      data: filaPago({ viaje_Id: "viaje-autorizado", estado: "autorizado" }),
      error: null,
    });

    const autorizado = await autorizarPago("viaje-autorizado", "orden-autorizada");

    expect(autorizado.estado).toBe("autorizado");
    expect(builder.update).toHaveBeenCalledWith({
      estado: "autorizado",
      paymentId: undefined,
      total: undefined,
      moneda: undefined,
    });
  });

  it("falla si no existe un pago para ese viaje", async () => {
    builder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      autorizarPago("viaje-inexistente-999", "orden-inexistente")
    ).rejects.toThrow(
      "no existe un tipo de pago registrado que este asociado para dicho viaje"
    );
  });

  it("rechaza una orden ya procesada, incluso para otro viaje", async () => {
    builder.maybeSingle.mockResolvedValueOnce({
      data: filaPago({ viaje_Id: "viaje-primero" }),
      error: null,
    });
    builder.single.mockResolvedValueOnce({
      data: filaPago({ viaje_Id: "viaje-primero", estado: "autorizado" }),
      error: null,
    });
    await autorizarPago("viaje-primero", "orden-repetida");

    await expect(
      autorizarPago("viaje-segundo", "orden-repetida")
    ).rejects.toThrow("Esta orden de pago ya fue procesada anteriormente");
  });

  it("rechaza un pago pendiente y actualiza su estado", async () => {
    builder.maybeSingle.mockResolvedValueOnce({
      data: filaPago({ viaje_Id: "viaje-rechazado" }),
      error: null,
    });
    builder.single.mockResolvedValueOnce({
      data: filaPago({ viaje_Id: "viaje-rechazado", estado: "rechazado" }),
      error: null,
    });

    const rechazado = await rechazarPago("viaje-rechazado");

    expect(rechazado.estado).toBe("rechazado");
    expect(builder.update).toHaveBeenCalledWith({ estado: "rechazado" });
  });

  it("falla al rechazar un viaje sin pago registrado", async () => {
    builder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(rechazarPago("viaje-inexistente-888")).rejects.toThrow(
      "no existe un tipo de pago registrado que este asociado para dicho viaje"
    );
  });

  it("no permite autorizar un pago que ya no está pendiente", async () => {
    builder.maybeSingle.mockResolvedValueOnce({
      data: filaPago({ viaje_Id: "viaje-ya-autorizado", estado: "autorizado" }),
      error: null,
    });

    await expect(
      autorizarPago("viaje-ya-autorizado", "orden-segunda")
    ).rejects.toThrow("El pago no fue procesado aún");
  });

  it("no permite rechazar un pago que ya no está pendiente", async () => {
    builder.maybeSingle.mockResolvedValueOnce({
      data: filaPago({ viaje_Id: "viaje-ya-autorizado", estado: "autorizado" }),
      error: null,
    });

    await expect(rechazarPago("viaje-ya-autorizado")).rejects.toThrow(
      "El pago no fue procesado aún"
    );
  });
});
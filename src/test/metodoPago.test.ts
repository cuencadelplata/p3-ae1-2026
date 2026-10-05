import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../supabaseClient", () => {
  return {
    supabase: {
      from: vi.fn(),
    },
  };
});

import { supabase } from "../supabaseClient";
import { registrarMetodoPago, buscarPagoPorViaje } from "../metodo-pago/procesoPago";

let builder: any;

function filaPago(overrides: Record<string, any> = {}) {
  return {
    pago_Id: "uuid-test",
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
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  };
  (supabase.from as any).mockReturnValue(builder);
});


describe("registrarMetodoPago", () => {
  it("registra un método de pago válido con estado inicial 'pendiente'", async () => {
    builder.single.mockResolvedValueOnce({
      data: filaPago({ pago_Id: "pago-A", viaje_Id: "viajeA" }),
      error: null,
    });

    const metodo = await registrarMetodoPago("cliente1", "viajeA", "efectivo");
    expect(metodo.clienteId).toBe("cliente1");
    expect(metodo.viajeId).toBe("viajeA");
    expect(metodo.tipo).toBe("efectivo");
    expect(metodo.estado).toBe("pendiente");
  });


  it("genera un pagoId distinto en cada registro", async () => {
    builder.single
      .mockResolvedValueOnce({
        data: filaPago({ pago_Id: "pago-B", viaje_Id: "viajeB" }),
        error: null,
      })
      .mockResolvedValueOnce({
        data: filaPago({ pago_Id: "pago-C", viaje_Id: "viajeC" }),
        error: null,
      });

    const metodo1 = await registrarMetodoPago("cliente1", "viajeB", "efectivo");
    const metodo2 = await registrarMetodoPago("cliente1", "viajeC", "efectivo");
    expect(metodo1.pagoId).not.toBe(metodo2.pagoId);
  });


  it("lanza error si clienteId está vacío", async () => {
    await expect(registrarMetodoPago("", "viajeD", "efectivo")).rejects.toThrow(
      "clienteId y viajeId deben existir"
    );
  });


  it("lanza error si viajeId está vacío", async () => {
    await expect(registrarMetodoPago("cliente1", "", "efectivo")).rejects.toThrow(
      "clienteId y viajeId deben existir"
    );
  });


  it("acepta distintos tipos de pago válidos", async () => {
    builder.single
      .mockResolvedValueOnce({
        data: filaPago({ viaje_Id: "viajeE", tipo: "efectivo" }),
        error: null,
      })
      .mockResolvedValueOnce({
        data: filaPago({ viaje_Id: "viajeF", tipo: "tarjeta" }),
        error: null,
      });

    const efectivo = await registrarMetodoPago("cliente1", "viajeE", "efectivo");
    const tarjeta = await registrarMetodoPago("cliente1", "viajeF", "tarjeta");
    expect(efectivo.tipo).toBe("efectivo");
    expect(tarjeta.tipo).toBe("tarjeta");
  });


  it("queda registrado y se puede volver a buscar por viajeId", async () => {
    builder.single.mockResolvedValueOnce({
      data: filaPago({ viaje_Id: "viajeG" }),
      error: null,
    });
    builder.maybeSingle.mockResolvedValueOnce({
      data: filaPago({ viaje_Id: "viajeG" }),
      error: null,
    });

    await registrarMetodoPago("cliente1", "viajeG", "efectivo");
    const encontrado = await buscarPagoPorViaje("viajeG");
    expect(encontrado).toBeDefined();
    expect(encontrado?.viajeId).toBe("viajeG");
  });
});


describe("buscarPagoPorViaje", () => {
  it("devuelve undefined si no existe un pago para ese viaje", async () => {
    builder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const resultado = await buscarPagoPorViaje("viaje-que-no-existe-123");
    expect(resultado).toBeUndefined();
  });


  it("encuentra el pago correcto entre varios registrados", async () => {
    builder.single
      .mockResolvedValueOnce({
        data: filaPago({ cliente_Id: "clienteX", viaje_Id: "viajeH", tipo: "efectivo" }),
        error: null,
      })
      .mockResolvedValueOnce({
        data: filaPago({ cliente_Id: "clienteY", viaje_Id: "viajeI", tipo: "tarjeta" }),
        error: null,
      });
    builder.maybeSingle.mockResolvedValueOnce({
      data: filaPago({ cliente_Id: "clienteY", viaje_Id: "viajeI", tipo: "tarjeta" }),
      error: null,
    });

    await registrarMetodoPago("clienteX", "viajeH", "efectivo");
    await registrarMetodoPago("clienteY", "viajeI", "tarjeta");
    const resultado = await buscarPagoPorViaje("viajeI");
    expect(resultado?.clienteId).toBe("clienteY");
    expect(resultado?.tipo).toBe("tarjeta");
  });
});
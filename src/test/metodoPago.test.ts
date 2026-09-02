import { describe, it, expect } from "vitest";
import {
  registrarMetodoPago,
  buscarPagoPorViaje,
} from "../metodo-pago/procesoPago";

describe("registrarMetodoPago (RF-7.2 - Método de pago)", () => {
  it("registra un método de pago válido con estado inicial 'pendiente'", () => {
    const metodo = registrarMetodoPago("cliente1", "viajeA", "efectivo");
    expect(metodo.clienteId).toBe("cliente1");
    expect(metodo.viajeId).toBe("viajeA");
    expect(metodo.tipo).toBe("efectivo");
    expect(metodo.estado).toBe("pendiente");
  });

  it("genera un pagoId distinto en cada registro", () => {
    const metodo1 = registrarMetodoPago("cliente1", "viajeB", "efectivo");
    const metodo2 = registrarMetodoPago("cliente1", "viajeC", "efectivo");
    expect(metodo1.pagoId).not.toBe(metodo2.pagoId);
  });

  it("lanza error si clienteId está vacío", () => {
    expect(() => registrarMetodoPago("", "viajeD", "efectivo")).toThrow(
      "clienteId y viajeId debe existir"
    );
  });

  it("lanza error si viajeId está vacío", () => {
    expect(() => registrarMetodoPago("cliente1", "", "efectivo")).toThrow(
      "clienteId y viajeId debe existir"
    );
  });

  it("acepta distintos tipos de pago válidos", () => {
    const efectivo = registrarMetodoPago("cliente1", "viajeE", "efectivo");
    const tarjeta = registrarMetodoPago("cliente1", "viajeF", "tarjeta");
    expect(efectivo.tipo).toBe("efectivo");
    expect(tarjeta.tipo).toBe("tarjeta");
  });

  it("queda registrado y se puede volver a buscar por viajeId", () => {
    registrarMetodoPago("cliente1", "viajeG", "efectivo");
    const encontrado = buscarPagoPorViaje("viajeG");
    expect(encontrado).toBeDefined();
    expect(encontrado?.viajeId).toBe("viajeG");
  });
});

describe("buscarPagoPorViaje", () => {
  it("devuelve undefined si no existe un pago para ese viaje", () => {
    const resultado = buscarPagoPorViaje("viaje-que-no-existe-123");
    expect(resultado).toBeUndefined();
  });

  it("encuentra el pago correcto entre varios registrados", () => {
    registrarMetodoPago("clienteX", "viajeH", "efectivo");
    registrarMetodoPago("clienteY", "viajeI", "tarjeta");
    const resultado = buscarPagoPorViaje("viajeI");
    expect(resultado?.clienteId).toBe("clienteY");
    expect(resultado?.tipo).toBe("tarjeta");
  });
});
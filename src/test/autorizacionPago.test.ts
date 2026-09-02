import { describe, it, expect } from "vitest";
import {
  registrarMetodoPago,
  autorizarPago,
  rechazarPago,
} from "../metodo-pago/procesoPago";

describe("autorizarPago (RF-7.3 - Autorización/captura)", () => {
  it("autoriza un pago que está en estado 'pendiente'", () => {
    registrarMetodoPago("cliente1", "viajeJ", "efectivo");
    const autorizado = autorizarPago("viajeJ");
    expect(autorizado.estado).toBe("autorizado");
  });

  it("lanza error si no existe un método de pago para ese viaje", () => {
    expect(() => autorizarPago("viaje-inexistente-999")).toThrow(
      "no existe un tipo de pago registrado que este asociado para dicho viaje"
    );
  });

  it("lanza error si se intenta autorizar un pago que ya fue autorizado", () => {
    registrarMetodoPago("cliente1", "viajeK", "efectivo");
    autorizarPago("viajeK");
    expect(() => autorizarPago("viajeK")).toThrow(
      "El pago no fue procesado aún"
    );
  });

  it("lanza error al intentar autorizar un pago que ya fue rechazado", () => {
    registrarMetodoPago("cliente1", "viajeN", "efectivo");
    rechazarPago("viajeN");
    expect(() => autorizarPago("viajeN")).toThrow(
      "El pago no fue procesado aún"
    );
  });

  it("rechaza un pago pendiente y cambia su estado a 'rechazado'", () => {
    registrarMetodoPago("cliente1", "viajeL", "efectivo");
    const rechazado = rechazarPago("viajeL");
    expect(rechazado.estado).toBe("rechazado");
  });

  it("lanza error al rechazar un viaje sin método de pago registrado", () => {
    expect(() => rechazarPago("viaje-inexistente-888")).toThrow(
      "no existe un tipo de pago registrado que este asociado para dicho viaje"
    );
  });

  it("lanza error al intentar rechazar un pago que ya fue autorizado", () => {
    registrarMetodoPago("cliente1", "viajeM", "efectivo");
    autorizarPago("viajeM");
    expect(() => rechazarPago("viajeM")).toThrow(
      "El pago no fue procesado aún"
    );
  });
});
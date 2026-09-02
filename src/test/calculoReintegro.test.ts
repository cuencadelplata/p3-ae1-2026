import { describe, it, expect } from "vitest";
import { calculoReintegro } from "../../src/6-reintegro/calculoReintegro";
import { cancelacionesDeEjemplo } from "../../src/mock/cancelacionMock";

describe("calculoReintegro", () => {

  it("calcula el 95% de un monto típico", () => {
    const resultado = calculoReintegro(1000);
    expect(resultado).toBe(950);
  });

  it("calcula el 95% de un monto grande", () => {
    const resultado = calculoReintegro(100000);
    expect(resultado).toBe(95000);
  });

  it("calcula el 95% de un monto chico", () => {
    const resultado = calculoReintegro(10);
    expect(resultado).toBe(9.5);
  });

  it("devuelve 0 si el monto de cancelación es 0", () => {
    const resultado = calculoReintegro(0);
    expect(resultado).toBe(0);
  });

  it("funciona con el primer dato del mock (monto 3000)", () => {
    const primero = cancelacionesDeEjemplo[0];
    const resultado = calculoReintegro(primero.montoCancelacion);
    expect(resultado).toBe(2850); // 3000 * 0.95
  });

  it("funciona con el segundo dato del mock (monto 4500)", () => {
    const segundo = cancelacionesDeEjemplo[1];
    const resultado = calculoReintegro(segundo.montoCancelacion);
    expect(resultado).toBe(4275); // 4500 * 0.95
  });

  it("maneja montos con decimales", () => {
    const resultado = calculoReintegro(999.99);
    expect(resultado).toBeCloseTo(949.9905);
  });

  it("nunca devuelve un valor mayor al monto original", () => {
    const monto = 1000;
    const resultado = calculoReintegro(monto);
    expect(resultado).toBeLessThanOrEqual(monto);
  });

});
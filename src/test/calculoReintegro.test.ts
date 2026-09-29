import { describe, it, expect } from "vitest";
import { calculoReintegro } from "../../src/6-reintegro/calculoReintegro";

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

  it("calcula el reintegro de una cancelación con cargo de 3000 (equivalente a M6/RF-7.4)", () => {
    const resultado = calculoReintegro(3000);
    expect(resultado).toBe(2850); // 3000 * 0.95
  });

  it("calcula el reintegro de una cancelación con cargo de 4500 (equivalente a M6/RF-7.4)", () => {
    const resultado = calculoReintegro(4500);
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
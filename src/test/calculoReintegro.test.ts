import { describe, it, expect } from "vitest";
import { calculoReintegro } from "../reintegro/calculoReintegro";

describe("calculoReintegro", () => {
  it("calcula el 95% de un monto típico", () => {
    expect(calculoReintegro(1000)).toBe(950);
  });

  it("calcula el 95% de un monto grande", () => {
    expect(calculoReintegro(100000)).toBe(95000);
  });

  it("calcula el 95% de un monto chico", () => {
    expect(calculoReintegro(10)).toBe(9.5);
  });

  it("devuelve 0 si el monto de cancelación es 0", () => {
    expect(calculoReintegro(0)).toBe(0);
  });

  it("calcula el reintegro de un cargo de 3000", () => {
    expect(calculoReintegro(3000)).toBe(2850);
  });

  it("calcula el reintegro de un cargo de 4500", () => {
    expect(calculoReintegro(4500)).toBe(4275);
  });

  it("maneja montos con decimales", () => {
    expect(calculoReintegro(999.99)).toBeCloseTo(949.9905);
  });

  it("nunca devuelve un valor mayor al monto original", () => {
    expect(calculoReintegro(1000)).toBeLessThanOrEqual(1000);
  });
});
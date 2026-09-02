import { describe, it, expect } from "vitest";
import { esPagoDuplicado } from "../../src/5-pago-duplicado/verificaPagoDuplicado";
import { registrosDeEjemplo } from "../../src/mock/registroPagoMock";

describe("esPagoDuplicado", () => {

  it("detecta una orden que ya existe en el mock (o1)", () => {
    const resultado = esPagoDuplicado("o1", registrosDeEjemplo);
    expect(resultado).toBe(true);
  });

  it("detecta la segunda orden del mock (o2)", () => {
    const resultado = esPagoDuplicado("o2", registrosDeEjemplo);
    expect(resultado).toBe(true);
  });

  it("no marca como duplicado una orden que no existe", () => {
    const resultado = esPagoDuplicado("o-nueva", registrosDeEjemplo);
    expect(resultado).toBe(false);
  });

  it("distingue entre ids parecidos pero no iguales", () => {
    const resultado = esPagoDuplicado("o1x", registrosDeEjemplo);
    expect(resultado).toBe(false);
  });

  it("es sensible a mayúsculas/minúsculas", () => {
    const resultado = esPagoDuplicado("O1", registrosDeEjemplo); // mayúscula
    expect(resultado).toBe(false); // "O1" no es igual a "o1"
  });

  it("funciona con una lista vacía (nunca hay duplicado)", () => {
    const resultado = esPagoDuplicado("cualquier-id", []);
    expect(resultado).toBe(false);
  });

  it("funciona con un id vacío", () => {
    const resultado = esPagoDuplicado("", registrosDeEjemplo);
    expect(resultado).toBe(false);
  });

});
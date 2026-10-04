import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker, EstadoCircuito } from "../src/patrones/circuitBreaker";

describe("Patrón de diseño Circuit Breaker", () => {
  it("inicia en estado CLOSED y permite ejecuciones exitosas", async () => {
    const breaker = new CircuitBreaker({ nombre: "Test", umbralFallos: 2 });
    expect(breaker.getEstado()).toBe(EstadoCircuito.CLOSED);

    const resultado = await breaker.ejecutar(async () => "ok");
    expect(resultado).toBe("ok");
    expect(breaker.getEstado()).toBe(EstadoCircuito.CLOSED);
  });

  it("pasa a estado OPEN tras alcanzar el umbral de fallos consecutivos", async () => {
    const breaker = new CircuitBreaker({ nombre: "Test", umbralFallos: 2, tiempoEsperaMs: 5000 });

    // Primer fallo
    await expect(
      breaker.ejecutar(async () => {
        throw new Error("fallo 1");
      })
    ).rejects.toThrow("fallo 1");
    expect(breaker.getEstado()).toBe(EstadoCircuito.CLOSED);

    // Segundo fallo -> Se abre el circuito
    await expect(
      breaker.ejecutar(async () => {
        throw new Error("fallo 2");
      })
    ).rejects.toThrow("fallo 2");
    expect(breaker.getEstado()).toBe(EstadoCircuito.OPEN);
  });

  it("en estado OPEN ejecuta el fallback inmediatamente sin llamar al servicio", async () => {
    const breaker = new CircuitBreaker({ nombre: "Test", umbralFallos: 1, tiempoEsperaMs: 5000 });

    // Provocamos la apertura
    await expect(
      breaker.ejecutar(async () => {
        throw new Error("caída");
      })
    ).rejects.toThrow();

    expect(breaker.getEstado()).toBe(EstadoCircuito.OPEN);

    // Llamada posterior: debe ejecutar fallback directamente
    const spy = vi.fn();
    const fallbackRes = await breaker.ejecutar(spy, () => "valor-degradado-fallback");

    expect(spy).not.toHaveBeenCalled();
    expect(fallbackRes).toBe("valor-degradado-fallback");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../infraestructura/redis", () => ({
  estaEnCache: vi.fn(),
  marcarEnCache: vi.fn(),
}));
vi.mock("../infraestructura/rabbit", () => ({ publicar: vi.fn() }));
vi.mock("../reintegro/reintegroBD", () => ({
  existeOrden: vi.fn(),
  insertarReintegro: vi.fn(),
}));
vi.mock("../reintegro/obtenerCargo", async (importOriginal) => {
  const real = await importOriginal<typeof import("../reintegro/obtenerCargo")>();
  return { ...real, obtenerCargo: vi.fn() };
});

import {
  procesarReintegro,
  type EventoCancelacionM6,
} from "../reintegro/procesarReintegro";
import { estaEnCache, marcarEnCache } from "../infraestructura/redis";
import { publicar } from "../infraestructura/rabbit";
import { existeOrden, insertarReintegro } from "../reintegro/reintegroBD";
import { obtenerCargo, ErrorTransitorio } from "../reintegro/obtenerCargo";

const eventoCliente: EventoCancelacionM6 = {
  viajeId: "V-1",
  clienteId: "C-1",
  conductorId: "D-1",
  motivo: "tardó demasiado en llegar",
  evento: "cancelacion_cliente",
  timestamp: "2026-09-28T20:10:00Z",
};

const eventoConductor: EventoCancelacionM6 = {
  ...eventoCliente,
  evento: "despacho.reabrir",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(estaEnCache).mockResolvedValue(false);
  vi.mocked(existeOrden).mockResolvedValue(false);
  vi.mocked(obtenerCargo).mockResolvedValue(1000);
  vi.mocked(insertarReintegro).mockResolvedValue(true);
});

describe("procesarReintegro (RF-7.5) — contrato real de M6", () => {
  it("cancelación del cliente: calcula el 95%, guarda, cachea y publica reintegro.procesado", async () => {
    const resultado = await procesarReintegro(eventoCliente);

    expect(resultado).toBe("procesado");
    expect(insertarReintegro).toHaveBeenCalledWith({
      idOrden: "V-1",
      viajeId: "V-1",
      montoCancelacion: 1000,
      montoReintegro: 950,
    });
    expect(marcarEnCache).toHaveBeenCalledWith("V-1");
    expect(publicar).toHaveBeenCalledWith(
      "reintegro.procesado",
      { idOrden: "V-1", viajeId: "V-1", montoReintegro: 950 },
      "V-1"
    );
  });

  it("traduce 'cancelacion_cliente' a requestedBy: 'cliente' al llamar a RF-7.4", async () => {
    await procesarReintegro(eventoCliente);

    expect(obtenerCargo).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: "V-1", requestedBy: "cliente" })
    );
  });

  it("traduce 'despacho.reabrir' a requestedBy: 'conductor' al llamar a RF-7.4", async () => {
    vi.mocked(obtenerCargo).mockResolvedValue(0);

    await procesarReintegro(eventoConductor);

    expect(obtenerCargo).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: "V-1", requestedBy: "conductor" })
    );
  });

  it("redondea el reintegro a 2 decimales", async () => {
    vi.mocked(obtenerCargo).mockResolvedValue(333.33);

    await procesarReintegro(eventoCliente);

    expect(insertarReintegro).toHaveBeenCalledWith(
      expect.objectContaining({ montoReintegro: 316.66 })
    );
  });

  it("sin cargo (cancela el conductor): no guarda ni publica", async () => {
    vi.mocked(obtenerCargo).mockResolvedValue(0);

    const resultado = await procesarReintegro(eventoConductor);

    expect(resultado).toBe("sin_cargo");
    expect(insertarReintegro).not.toHaveBeenCalled();
    expect(publicar).not.toHaveBeenCalled();
  });

  it("si RF-7.4 falla (transitorio) propaga el error y no guarda nada", async () => {
    vi.mocked(obtenerCargo).mockRejectedValue(new ErrorTransitorio("caído"));

    await expect(procesarReintegro(eventoCliente)).rejects.toBeInstanceOf(ErrorTransitorio);
    expect(insertarReintegro).not.toHaveBeenCalled();
    expect(publicar).not.toHaveBeenCalled();
  });
});

describe("idempotencia (RF-7.6 / RNF-08)", () => {
  it("duplicado detectado en Redis: corta antes de llamar a RF-7.4", async () => {
    vi.mocked(estaEnCache).mockResolvedValue(true);

    const resultado = await procesarReintegro(eventoCliente);

    expect(resultado).toBe("duplicado");
    expect(obtenerCargo).not.toHaveBeenCalled();
    expect(insertarReintegro).not.toHaveBeenCalled();
    expect(publicar).not.toHaveBeenCalled();
  });

  it("duplicado detectado en la base (Redis vacío): repone la caché", async () => {
    vi.mocked(existeOrden).mockResolvedValue(true);

    const resultado = await procesarReintegro(eventoCliente);

    expect(resultado).toBe("duplicado");
    expect(marcarEnCache).toHaveBeenCalledWith("V-1");
    expect(publicar).not.toHaveBeenCalled();
  });

  it("si el INSERT pierde la carrera (clave única), no publica el evento", async () => {
    vi.mocked(insertarReintegro).mockResolvedValue(false);

    const resultado = await procesarReintegro(eventoCliente);

    expect(resultado).toBe("duplicado");
    expect(publicar).not.toHaveBeenCalled();
  });
});

describe("concurrencia (RNF-09)", () => {
  it("10 mensajes idénticos simultáneos generan UN reintegro y UN evento", async () => {
    const guardados = new Set<string>();
    vi.mocked(insertarReintegro).mockImplementation(async (r) => {
      await new Promise((res) => setTimeout(res, 5));
      if (guardados.has(r.idOrden)) return false;
      guardados.add(r.idOrden);
      return true;
    });

    const resultados = await Promise.all(
      Array.from({ length: 10 }, () => procesarReintegro(eventoCliente))
    );

    expect(resultados.filter((r) => r === "procesado")).toHaveLength(1);
    expect(resultados.filter((r) => r === "duplicado")).toHaveLength(9);
    expect(publicar).toHaveBeenCalledTimes(1);
  });

  it("el problema: sin restricción única cada mensaje generaría su propio reintegro", async () => {
    vi.mocked(insertarReintegro).mockResolvedValue(true);

    await Promise.all(Array.from({ length: 10 }, () => procesarReintegro(eventoCliente)));

    expect(publicar).toHaveBeenCalledTimes(10);
  });
});

describe("caída de Redis", () => {
  it("caso 1: Redis caído (o vacío) + orden NUEVA → se procesa igual usando la base", async () => {
    const resultado = await procesarReintegro(eventoCliente);

    expect(resultado).toBe("procesado");
    expect(existeOrden).toHaveBeenCalledWith("V-1");
  });

  it("caso 2: Redis caído (o vacío) + orden YA procesada → detecta el duplicado por la base", async () => {
    vi.mocked(existeOrden).mockResolvedValue(true);

    const resultado = await procesarReintegro(eventoCliente);

    expect(resultado).toBe("duplicado");
  });
});

describe("caída de la base de datos", () => {
  it("caso 11: base caída + orden YA cacheada en Redis → responde duplicado sin tocar la base", async () => {
    vi.mocked(estaEnCache).mockResolvedValue(true);
    vi.mocked(existeOrden).mockRejectedValue(new Error("Postgres: connection refused"));

    const resultado = await procesarReintegro(eventoCliente);

    expect(resultado).toBe("duplicado");
    expect(existeOrden).not.toHaveBeenCalled();
  });

  it("caso 12: base caída + orden NUEVA → no puede garantizar idempotencia, propaga el error", async () => {
    vi.mocked(existeOrden).mockRejectedValue(new Error("Postgres: connection refused"));

    await expect(procesarReintegro(eventoCliente)).rejects.toThrow("connection refused");
    expect(insertarReintegro).not.toHaveBeenCalled();
    expect(obtenerCargo).not.toHaveBeenCalled();
  });

  it("caso 13: el INSERT falla por caída de la base → no avisa un reintegro que no se guardó", async () => {
    vi.mocked(insertarReintegro).mockRejectedValue(new Error("Postgres: connection refused"));

    await expect(procesarReintegro(eventoCliente)).rejects.toThrow("connection refused");
    expect(publicar).not.toHaveBeenCalled();
  });
});
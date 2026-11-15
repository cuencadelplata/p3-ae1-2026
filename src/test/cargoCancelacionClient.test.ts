import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  obtenerCargo,
  ErrorTransitorio,
  ErrorPermanente,
} from "../6-reintegro/cargoCancelacionClient";

// simula respuesta de 7.4

const fetchMock = vi.fn();

const body = {
  tripId: "V-1",
  requestedBy: "cliente" as const,
  vehicleType: "auto" as const,
  tripStatus: "asignado",
  estimatedFare: 5000,
};

const respuesta = (status: number, json: unknown) =>
  new Response(JSON.stringify(json), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("obtenerCargo (cliente HTTP a RF-7.4)", () => {
  it("devuelve el charge cuando RF-7.4 responde 200", async () => {
    fetchMock.mockResolvedValue(respuesta(200, { charge: 1000 }));

    await expect(obtenerCargo(body)).resolves.toBe(1000);
  });

  it("hace POST al endpoint de cargo-cancelacion con el body en JSON", async () => {
    fetchMock.mockResolvedValue(respuesta(200, { charge: 0 }));

    await obtenerCargo(body);

    const [url, opciones] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:3007/api/m7/cargo-cancelacion");
    expect(opciones.method).toBe("POST");
    expect(JSON.parse(opciones.body)).toEqual(body);
  });

  it("5xx es error transitorio (se puede reintentar)", async () => {
    fetchMock.mockResolvedValue(respuesta(503, { error: "caído" }));

    await expect(obtenerCargo(body)).rejects.toBeInstanceOf(ErrorTransitorio);
  });

  it("timeout / servicio caído es error transitorio", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(obtenerCargo(body)).rejects.toBeInstanceOf(ErrorTransitorio);
  });

  it("4xx es error permanente (reintentar no lo arregla)", async () => {
    fetchMock.mockResolvedValue(respuesta(400, { error: "requestedBy inválido" }));

    await expect(obtenerCargo(body)).rejects.toBeInstanceOf(ErrorPermanente);
  });

  it("respuesta 200 sin 'charge' numérico es error permanente", async () => {
    fetchMock.mockResolvedValue(respuesta(200, { algo: "raro" }));

    await expect(obtenerCargo(body)).rejects.toBeInstanceOf(ErrorPermanente);
  });
});
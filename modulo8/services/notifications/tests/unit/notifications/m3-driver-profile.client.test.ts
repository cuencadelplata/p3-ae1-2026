import { describe, expect, it, vi } from "vitest";
import { createM3DriverNameLookup } from "../../../src/notifications/m3-driver-profile.client";

describe("consulta opcional del nombre del conductor en M3", () => {
  it("usa la ruta real de M3 y sólo acepta el usuario solicitado", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "101", nombre: "Carlos", apellido: "Gómez", email: "privado@ejemplo.com" }),
    });
    const lookup = createM3DriverNameLookup("http://m3-conductor:3000/", request as typeof fetch);
    expect(await lookup(101)).toBe("Carlos Gómez");
    expect(request).toHaveBeenCalledWith("http://m3-conductor:3000/api/conductores/101", expect.objectContaining({ signal: expect.any(AbortSignal) }));

    request.mockResolvedValue({ ok: true, json: async () => ({ id: "102", nombre: "Otra", apellido: "Persona" }) });
    expect(await lookup(101)).toBeNull();
  });

  it("degrada a aviso sin nombre si M3 falla", async () => {
    const request = vi.fn().mockRejectedValue(new Error("M3 no disponible"));
    expect(await createM3DriverNameLookup("http://m3-conductor:3000", request as typeof fetch)(101)).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import { createM1DriverNameLookup } from "../../../src/notifications/m1-driver-name.client";

describe("consulta opcional del nombre del conductor en M1", () => {
  const base = "http://m1-identidad-acceso:3001";
  const key = "m1-internal-test";

  it("consulta el nombre con la clave interna y valida la identidad canónica", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ userId: 101, nombre: " Carlos ", apellido: " Gómez " }));
    const lookup = createM1DriverNameLookup(`${base}/`, key, request as typeof fetch);
    expect(await lookup(101)).toBe("Carlos Gómez");
    expect(request).toHaveBeenCalledWith(`${base}/auth/usuarios/101/nombre`, {
      headers: { "X-Internal-Api-Key": key },
      signal: expect.any(AbortSignal),
      redirect: "error",
    });
    request.mockResolvedValue(Response.json({ userId: 102, nombre: "Otra", apellido: "Persona" }));
    expect(await lookup(101)).toBeNull();
    request.mockResolvedValue(Response.json({ userId: "101", nombre: "Carlos", apellido: "Gómez" }));
    expect(await lookup(101)).toBeNull();
  });

  it.each([401, 404, 503])("deja el aviso sin nombre si M1 devuelve %s", async (status) => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status }));
    expect(await createM1DriverNameLookup(base, key, request as typeof fetch)(101)).toBeNull();
  });

  it("deja el aviso sin nombre ante un error de red", async () => {
    const request = vi.fn().mockRejectedValue(new Error("M1 no disponible"));
    expect(await createM1DriverNameLookup(base, key, request as typeof fetch)(101)).toBeNull();
  });
});

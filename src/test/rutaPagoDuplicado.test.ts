import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("../reintegro/reintegroBD", () => ({ existeOrden: vi.fn() }));
vi.mock("../infraestructura/redis", () => ({
  estaEnCache: vi.fn(),
  marcarEnCache: vi.fn(),
}));

import rutaPagoDuplicado from "../pago-duplicado/rutaPagoDuplicado";
import { existeOrden } from "../reintegro/reintegroBD";
import { estaEnCache, marcarEnCache } from "../infraestructura/redis";

const app = express();
app.use(express.json());
app.use(rutaPagoDuplicado);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(estaEnCache).mockResolvedValue(false);
  vi.mocked(existeOrden).mockResolvedValue(false);
});

describe("GET /pagos/:idOrden/duplicado", () => {
  it("true si está en Redis (no consulta la base)", async () => {
    vi.mocked(estaEnCache).mockResolvedValue(true);

    const r = await request(app).get("/pagos/ORD-1/duplicado");

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ idOrden: "ORD-1", esDuplicado: true });
    expect(existeOrden).not.toHaveBeenCalled();
  });

  it("true si no está en Redis pero sí en la base, y repone la caché", async () => {
    vi.mocked(existeOrden).mockResolvedValue(true);

    const r = await request(app).get("/pagos/ORD-2/duplicado");

    expect(r.body.esDuplicado).toBe(true);
    expect(marcarEnCache).toHaveBeenCalledWith("ORD-2");
  });

  it("false si no existe en ningún lado, y no cachea el 'no'", async () => {
    const r = await request(app).get("/pagos/ORD-NUEVA/duplicado");

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ idOrden: "ORD-NUEVA", esDuplicado: false });
    expect(marcarEnCache).not.toHaveBeenCalled();
  });

  it("503 si la base falla", async () => {
    vi.mocked(existeOrden).mockRejectedValue(new Error("db caída"));

    const r = await request(app).get("/pagos/ORD-1/duplicado");

    expect(r.status).toBe(503);
    expect(r.body.error).toBeDefined();
  });
});
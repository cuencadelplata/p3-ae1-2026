import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../infraestructura/basedatos", () => ({
  pool: { query: vi.fn() },
}));

import { pool } from "../infraestructura/basedatos";
import { insertarReintegro, existeOrden } from "../reintegro/reintegroBD";

const nuevo = {
  idOrden: "V-1",
  viajeId: "V-1",
  montoCancelacion: 1000,
  montoReintegro: 950,
};

beforeEach(() => {
  vi.mocked(pool.query).mockReset();
});

describe("insertarReintegro", () => {
  it("devuelve true si insertó la fila", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rowCount: 1 } as never);

    await expect(insertarReintegro(nuevo)).resolves.toBe(true);
  });

  it("devuelve false si la orden ya existía", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rowCount: 0 } as never);

    await expect(insertarReintegro(nuevo)).resolves.toBe(false);
  });

  it("devuelve false si rowCount es null", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rowCount: null } as never);

    await expect(insertarReintegro(nuevo)).resolves.toBe(false);
  });

  it("usa INSERT ... ON CONFLICT (id_orden) con parámetros (sin concatenar SQL)", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rowCount: 1 } as never);

    await insertarReintegro(nuevo);

    const [sql, params] = vi.mocked(pool.query).mock.calls[0] as unknown as [
      string,
      unknown[]
    ];

    expect(sql).toMatch(/insert into reintegros/i);
    expect(sql).toMatch(/on conflict\s*\(id_orden\)\s*do nothing/i);
    expect(params).toEqual(["V-1", "V-1", 1000, 950]);
  });

  it("usa el fallback en memoria si la base falla", async () => {
    vi.mocked(pool.query).mockRejectedValue(new Error("conexión perdida"));

    await expect(insertarReintegro(nuevo)).resolves.toBe(true);
  });
});

describe("existeOrden", () => {
  it("true si hay fila", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rowCount: 1 } as never);

    await expect(existeOrden("V-1")).resolves.toBe(true);
  });

  it("false si no hay fila", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rowCount: 0 } as never);

    await expect(existeOrden("V-X")).resolves.toBe(false);
  });

  it("usa el fallback en memoria si la base falla", async () => {
    vi.mocked(pool.query).mockRejectedValue(new Error("conexión perdida"));

    await expect(existeOrden("V-1")).resolves.toBe(true);
  });
});
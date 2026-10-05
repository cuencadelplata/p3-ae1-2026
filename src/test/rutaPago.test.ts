import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("../supabaseClient", () => {
  return {
    supabase: {
      from: vi.fn(),
    },
  };
});

vi.mock("../infraestructura/redis", () => {
  return {
    redis: {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    },
    redisBreaker: {
      ejecutar: vi.fn(async (fn: any) => await fn()),
    },
  };
});

import { supabase } from "../supabaseClient";
import { redis } from "../infraestructura/redis";
import rutaPago from "../metodo-pago/rutaPago";

const app = express();
app.use(express.json());
app.use(rutaPago);

let builder: any;

function filaPago(overrides: Record<string, any> = {}) {
  return {
    pago_Id: "uuid-test",
    cliente_Id: "cliente1",
    viaje_Id: "viaje-test",
    tipo: "efectivo",
    detalle: "",
    fecha: new Date().toISOString(),
    estado: "pendiente",
    paymentId: null,
    total: null,
    moneda: null,
    ...overrides,
  };
}

beforeEach(() => {
  builder = {
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  };
  (supabase.from as any).mockReturnValue(builder);

  // Por defecto: cache vacía (miss), y escritura/borrado de Redis "exitosos"
  (redis.get as any).mockResolvedValue(null);
  (redis.set as any).mockResolvedValue("OK");
  (redis.del as any).mockResolvedValue(1);
});


describe("POST /metodo-pago ruta", () => {
  it("devuelve 201 y el método de pago registrado", async () => {
    builder.single.mockResolvedValueOnce({
      data: filaPago({ viaje_Id: "viaje-http-1" }),
      error: null,
    });

    const respuesta = await request(app)
      .post("/metodo-pago")
      .send({ clienteId: "cliente1", viajeId: "viaje-http-1", tipo: "efectivo" });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.estado).toBe("pendiente");
    expect(respuesta.body.viajeId).toBe("viaje-http-1");
  });

  it("devuelve 400 si faltan datos obligatorios", async () => {
    const respuesta = await request(app)
      .post("/metodo-pago")
      .send({ tipo: "efectivo" });

    expect(respuesta.status).toBe(400);
  });

  it("devuelve 400 si el tipo de pago no es válido", async () => {
    const respuesta = await request(app)
      .post("/metodo-pago")
      .send({ clienteId: "cliente1", viajeId: "viaje-tipo-invalido", tipo: "bitcoin" });

    expect(respuesta.status).toBe(400);
  });
});


describe("GET /metodo-pago/:viajeId ruta", () => {
  it("devuelve 200 y el método de pago si existe (cache miss, consulta la base)", async () => {
    builder.maybeSingle.mockResolvedValueOnce({
      data: filaPago({ viaje_Id: "viaje-http-2", tipo: "tarjeta" }),
      error: null,
    });

    const respuesta = await request(app).get("/metodo-pago/viaje-http-2");

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.viajeId).toBe("viaje-http-2");
    expect(redis.set).toHaveBeenCalledWith(
      "m7:metodo-pago:viaje-http-2",
      expect.any(String),
      { EX: 30 }
    );
  });

  it("devuelve 200 desde la caché, sin consultar la base", async () => {
    const pagoCacheado = {
      pagoId: "uuid-cacheado",
      clienteId: "cliente1",
      viajeId: "viaje-cacheado",
      tipo: "efectivo",
      detalle: "",
      fecha: new Date().toISOString(),
      estado: "pendiente",
    };
    (redis.get as any).mockResolvedValueOnce(JSON.stringify(pagoCacheado));

    const respuesta = await request(app).get("/metodo-pago/viaje-cacheado");

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.viajeId).toBe("viaje-cacheado");
    expect(builder.maybeSingle).not.toHaveBeenCalled(); // no debería haber ido a la base
  });

  it("devuelve 404 si no existe un pago para ese viaje", async () => {
    builder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const respuesta = await request(app).get("/metodo-pago/viaje-que-no-existe-http");

    expect(respuesta.status).toBe(404);
  });
});


describe("POST /metodo-pago/:viajeId/autorizar", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("autoriza un pago pendiente, devuelve 200 e invalida la caché", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "mp-mock-123", status: "approved", transaction_amount: 1500 }),
    });

    builder.maybeSingle.mockResolvedValueOnce({
      data: filaPago({ viaje_Id: "viaje-http-3" }),
      error: null,
    });
    builder.single.mockResolvedValueOnce({
      data: filaPago({
        viaje_Id: "viaje-http-3",
        estado: "autorizado",
        paymentId: "mp-mock-123",
        total: 1500,
        moneda: "USD",
      }),
      error: null,
    });

    const respuesta = await request(app)
      .post("/metodo-pago/viaje-http-3/autorizar")
      .send({ idOrden: "orden-http-3", total: 1500, moneda: "USD" });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.estado).toBe("autorizado");
    expect(respuesta.body.paymentId).toBe("mp-mock-123");
    expect(respuesta.body.total).toBe(1500);
    expect(respuesta.body.moneda).toBe("USD");
    expect(redis.del).toHaveBeenCalledWith("m7:metodo-pago:viaje-http-3");
  });

  it("si no mandan moneda, usa 'ARS' por defecto", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "mp-mock-456", status: "approved", transaction_amount: 800 }),
    });

    builder.maybeSingle.mockResolvedValueOnce({
      data: filaPago({ viaje_Id: "viaje-sin-moneda" }),
      error: null,
    });
    builder.single.mockResolvedValueOnce({
      data: filaPago({
        viaje_Id: "viaje-sin-moneda",
        estado: "autorizado",
        paymentId: "mp-mock-456",
        total: 800,
        moneda: "ARS",
      }),
      error: null,
    });

    const respuesta = await request(app)
      .post("/metodo-pago/viaje-sin-moneda/autorizar")
      .send({ idOrden: "orden-sin-moneda", total: 800 });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.moneda).toBe("ARS");
  });

  it("devuelve 400 si falta el total", async () => {
    const respuesta = await request(app)
      .post("/metodo-pago/viaje-sin-total/autorizar")
      .send({ idOrden: "orden-sin-total" });

    expect(respuesta.status).toBe(400);
  });

  it("devuelve 400 si falta el idOrden", async () => {
    const respuesta = await request(app)
      .post("/metodo-pago/viaje-sin-orden/autorizar")
      .send({ total: 1500 });

    expect(respuesta.status).toBe(400);
  });

  it("devuelve 402 si Mercado Pago rechaza el pago", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "mp-mock-rejected", status: "rejected", transaction_amount: 1500 }),
    });

    const respuesta = await request(app)
      .post("/metodo-pago/viaje-rechazado-mp/autorizar")
      .send({ idOrden: "orden-rechazada", total: 1500 });

    expect(respuesta.status).toBe(402);
  });

  it("devuelve 400 si no existe método de pago para ese viaje", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "mp-mock-x", status: "approved", transaction_amount: 1000 }),
    });

    builder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const respuesta = await request(app)
      .post("/metodo-pago/viaje-inexistente-http/autorizar")
      .send({ idOrden: "orden-x", total: 1000 });

    expect(respuesta.status).toBe(400);
  });
});


describe("POST /metodo-pago/:viajeId/rechazar", () => {
  it("rechaza un pago pendiente, devuelve 200 e invalida la caché", async () => {
    builder.maybeSingle.mockResolvedValueOnce({
      data: filaPago({ viaje_Id: "viaje-http-4" }),
      error: null,
    });
    builder.single.mockResolvedValueOnce({
      data: filaPago({ viaje_Id: "viaje-http-4", estado: "rechazado" }),
      error: null,
    });

    const respuesta = await request(app).post("/metodo-pago/viaje-http-4/rechazar");

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.estado).toBe("rechazado");
    expect(redis.del).toHaveBeenCalledWith("m7:metodo-pago:viaje-http-4");
  });

  it("devuelve 400 si no existe método de pago para ese viaje", async () => {
    builder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const respuesta = await request(app).post("/metodo-pago/viaje-inexistente-http-2/rechazar");

    expect(respuesta.status).toBe(400);
  });
});
//Request: recibe de Express (app) y te devuelve un objeto que simula peticiones HTTP 
// .post= le dice a la petición que ruta usar
// .send= manda al server
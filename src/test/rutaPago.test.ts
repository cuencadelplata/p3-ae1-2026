import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import rutaPago from "../metodo-pago/rutaPago";

const app = express();
app.use(express.json());
app.use(rutaPago);

describe("POST /metodo-pago ruta", () => {
  it("devuelve 201 y el método de pago registrado", async () => {
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
      .send({ tipo: "efectivo" }); // faltan clienteId y viajeId

    expect(respuesta.status).toBe(400);
  });
});

describe("GET /metodo-pago/:viajeId ruta ", () => {
  it("devuelve 200 y el método de pago si existe", async () => {
    await request(app)
      .post("/metodo-pago")
      .send({ clienteId: "cliente1", viajeId: "viaje-http-2", tipo: "tarjeta" });

    const respuesta = await request(app).get("/metodo-pago/viaje-http-2");

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.viajeId).toBe("viaje-http-2");
  });

  it("devuelve 404 si no existe un pago para ese viaje", async () => {
    const respuesta = await request(app).get(
      "/metodo-pago/viaje-que-no-existe-http"
    );

    expect(respuesta.status).toBe(404);
  });
});

describe("POST /metodo-pago/:viajeId/autorizar (ruta HTTP)", () => {
  it("autoriza un pago pendiente y devuelve 200", async () => {
    await request(app)
      .post("/metodo-pago")
      .send({ clienteId: "cliente1", viajeId: "viaje-http-3", tipo: "efectivo" });

    const respuesta = await request(app)
      .post("/metodo-pago/viaje-http-3/autorizar")
      .send({ idOrden: "orden-http-3" });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.estado).toBe("autorizado");
  });

  it("devuelve 400 si no existe método de pago para ese viaje", async () => {
    const respuesta = await request(app).post(
      "/metodo-pago/viaje-inexistente-http/autorizar"
    );

    expect(respuesta.status).toBe(400);
  });
});

describe("POST /metodo-pago/:viajeId/rechazar (ruta HTTP)", () => {
  it("rechaza un pago pendiente y devuelve 200", async () => {
    await request(app)
      .post("/metodo-pago")
      .send({ clienteId: "cliente1", viajeId: "viaje-http-4", tipo: "efectivo" });

    const respuesta = await request(app).post(
      "/metodo-pago/viaje-http-4/rechazar"
    );

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.estado).toBe("rechazado");
  });

  it("devuelve 400 si no existe método de pago para ese viaje", async () => {
    const respuesta = await request(app).post(
      "/metodo-pago/viaje-inexistente-http-2/rechazar"
    );

    expect(respuesta.status).toBe(400);
  });
});
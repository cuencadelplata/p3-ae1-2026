import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";  //vi = para mocks 
import request from "supertest"; //simula los pedidos 
import express from "express"; //armar servidor para manejar rutas, peticiones y respuestas HTTP sin tener que escribir todo eso a mano.
import rutaPago from "../metodo-pago/rutaPago";
import * as procesoPago from "../metodo-pago/procesoPago"; //trae todo de procesoPago


const app = express(); //crea "servidor"
app.use(express.json());
app.use(rutaPago); 


describe("POST /metodo-pago ruta", () => {  // la petición HTTP se queda ahí, hasta que esa tarea puntual termine
  it("devuelve 201 y el método de pago registrado", async () => {
    const respuesta = await request(app)
      .post("/metodo-pago") //le dice a la petición que ruta usar
      .send({ clienteId: "cliente1", viajeId: "viaje-http-1", tipo: "efectivo" }); //manda

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

  it("devuelve 400 si el tipo de pago no es válido", async () => {
    const respuesta = await request(app)
      .post("/metodo-pago")
      .send({ clienteId: "cliente1", viajeId: "viaje-tipo-invalido", tipo: "bitcoin" });

    expect(respuesta.status).toBe(400);
  });
});





describe("GET /metodo-pago/:viajeId ruta ", () => {
  it("devuelve 200 y el método de pago si existe", async () => {
    await request(app)
      .post("/metodo-pago")
      .send({ clienteId: "cliente1", viajeId: "viaje-http-2", tipo: "tarjeta" }); //crea pago 

    const respuesta = await request(app).get("/metodo-pago/viaje-http-2");

    expect(respuesta.status).toBe(200); //aprueba 
    expect(respuesta.body.viajeId).toBe("viaje-http-2");
  });

  it("devuelve 404 si no existe un pago para ese viaje", async () => {
    const respuesta = await request(app).get(
      "/metodo-pago/viaje-que-no-existe-http"
    );

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

  it("autoriza un pago pendiente y devuelve 200 con el paymentId de Mercado Pago", async () => {
    await request(app)
      .post("/metodo-pago")
      .send({ clienteId: "cliente1", viajeId: "viaje-http-3", tipo: "efectivo" });

    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "mp-mock-123", status: "approved", transaction_amount: 1500 }),
    });

    const respuesta = await request(app)
      .post("/metodo-pago/viaje-http-3/autorizar")
      .send({ idOrden: "orden-http-3", total: 1500 });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.estado).toBe("autorizado");
    expect(respuesta.body.paymentId).toBe("mp-mock-123");
  });

  it("devuelve 400 si falta el total", async () => {
    await request(app)
      .post("/metodo-pago")
      .send({ clienteId: "cliente1", viajeId: "viaje-sin-total", tipo: "efectivo" });

    const respuesta = await request(app)
      .post("/metodo-pago/viaje-sin-total/autorizar")
      .send({ idOrden: "orden-sin-total" });

    expect(respuesta.status).toBe(400);
  });

  it("devuelve 400 si falta el idOrden", async () => {
    await request(app)
      .post("/metodo-pago")
      .send({ clienteId: "cliente1", viajeId: "viaje-sin-orden", tipo: "efectivo" });

    const respuesta = await request(app)
      .post("/metodo-pago/viaje-sin-orden/autorizar")
      .send({ total: 1500 });

    expect(respuesta.status).toBe(400);
  });

  it("devuelve 402 si Mercado Pago rechaza el pago", async () => {
    await request(app)
      .post("/metodo-pago")
      .send({ clienteId: "cliente1", viajeId: "viaje-rechazado-mp", tipo: "efectivo" });

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
    const respuesta = await request(app)
      .post("/metodo-pago/viaje-inexistente-http/autorizar")
      .send({ idOrden: "orden-x", total: 1000 });

    expect(respuesta.status).toBe(400);
  });
});






describe("POST /metodo-pago/:viajeId/rechazar", () => {
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



//Request: recibe de Express (app) y te devuelve un objeto que simula peticiones HTTP 
// .post= le dice a la petición que ruta usar
// .send= manda al server
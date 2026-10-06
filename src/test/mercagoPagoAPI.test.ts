import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import mercadoPagoAPI from "../mock/mercadoPagoAPI";

const app = express();
app.use(express.json());
app.use(mercadoPagoAPI);

describe("POST /mock-mercadopago/v1/payments (mock de Mercado Pago)", () => {
  it("aprueba el pago y devuelve id y status", async () => {
    const respuesta = await request(app)
      .post("/mock-mercadopago/v1/payments")
      .send({ viajeId: "viaje-1", total: 1500 });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.status).toBe("approved");
    expect(respuesta.body.transaction_amount).toBe(1500);
    expect(respuesta.body.id).toBeTruthy();
  });

  it("devuelve 400 si falta viajeId", async () => {
    const respuesta = await request(app)
      .post("/mock-mercadopago/v1/payments")
      .send({ total: 1500 });

    expect(respuesta.status).toBe(400);
  });

  it("devuelve 400 si total no es un número", async () => {
    const respuesta = await request(app)
      .post("/mock-mercadopago/v1/payments")
      .send({ viajeId: "viaje-1", total: "mil pesos" });

    expect(respuesta.status).toBe(400);
  });
});
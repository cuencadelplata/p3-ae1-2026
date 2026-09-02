import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import rutaReintegro from "../6-reintegro/rutaReintegro";

const app = express();
app.use(express.json());
app.use(rutaReintegro);

describe("POST /reintegro ruta", () => {
  it("devuelve 200 y el monto calculado con datos válidos", async () => {
    const respuesta = await request(app)
      .post("/reintegro")
      .send({ montoCancelacion: 1000, viajeId: "v1" });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.monto).toBe(950);
    expect(respuesta.body.viajeId).toBe("v1");
  });

  it("devuelve 400 si falta montoCancelacion", () => {
    return request(app)
      .post("/reintegro")
      .send({ viajeId: "v1" })
      .expect(400)
      .then((respuesta) => {
        expect(respuesta.body.error).toBe(
          "montoCancelacion y viajeId son requeridos"
        );
      });
  });

  it("devuelve 400 si falta viajeId", async () => {
    const respuesta = await request(app)
      .post("/reintegro")
      .send({ montoCancelacion: 1000 });

    expect(respuesta.status).toBe(400);
  });

  it("devuelve 400 si montoCancelacion no es un número", async () => {
    const respuesta = await request(app)
      .post("/reintegro")
      .send({ montoCancelacion: "mil", viajeId: "v1" });

    expect(respuesta.status).toBe(400);
  });
});
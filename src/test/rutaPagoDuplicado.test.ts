import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import rutaPagoDuplicado from "../5-pago-duplicado/rutaPagoDuplicado";

const app = express();
app.use(express.json());
app.use(rutaPagoDuplicado);

describe("GET /pagos/:idOrden/duplicado ruta ", () => {
  it("devuelve esDuplicado: true para una orden que ya existe (o1)", async () => {
    const respuesta = await request(app).get("/pagos/o1/duplicado");

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.idOrden).toBe("o1");
    expect(respuesta.body.esDuplicado).toBe(true);
  });

  it("devuelve esDuplicado: false para una orden nueva", async () => {
    const respuesta = await request(app).get(
      "/pagos/orden-que-no-existe/duplicado"
    );

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.esDuplicado).toBe(false);
  });
});
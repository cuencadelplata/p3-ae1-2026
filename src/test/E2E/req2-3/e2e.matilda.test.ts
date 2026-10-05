// src/test/E2E/m7Endpoints.e2e.test.ts
import { test, expect } from "@playwright/test";

// Requerimiento 7.5 - Reintegro
test.describe("RF-7.5 - Reintegro (POST /reintegro)", () => {

  test("calcula el 95% con datos válidos", async ({ request }) => {
    const respuesta = await request.post("/reintegro", {
      data: { montoCancelacion: 1000, viajeId: "e2e-reintegro-1" },
    });
    expect(respuesta.status()).toBe(200);
    const body = await respuesta.json();
    expect(body.monto).toBe(950);
    expect(body.viajeId).toBe("e2e-reintegro-1");
  });

  test("calcula correctamente con otro monto distinto", async ({ request }) => {
    const respuesta = await request.post("/reintegro", {
      data: { montoCancelacion: 3000, viajeId: "e2e-reintegro-2" },
    });
    expect(respuesta.status()).toBe(200);
    const body = await respuesta.json();
    expect(body.monto).toBe(2850);
  });

  test("devuelve 400 si falta montoCancelacion", async ({ request }) => {
    const respuesta = await request.post("/reintegro", {
      data: { viajeId: "e2e-reintegro-3" },
    });
    expect(respuesta.status()).toBe(400);
    const body = await respuesta.json();
    expect(body.error).toBeTruthy();
  });

  test("devuelve 400 si falta viajeId", async ({ request }) => {
    const respuesta = await request.post("/reintegro", {
      data: { montoCancelacion: 1000 },
    });
    expect(respuesta.status()).toBe(400);
  });

  test("devuelve 400 si montoCancelacion no es un número", async ({ request }) => {
    const respuesta = await request.post("/reintegro", {
      data: { montoCancelacion: "mil pesos", viajeId: "e2e-reintegro-4" },
    });
    expect(respuesta.status()).toBe(400);
  });

});
//

// Requerimiento 7.6 - Idempotencia
test.describe("RF-7.6 - Idempotencia (GET /pagos/:idOrden/duplicado)", () => {

  test("detecta como duplicado una orden que ya existe en el mock (o1)", async ({ request }) => {
    const respuesta = await request.get("/pagos/o1/duplicado");
    expect(respuesta.status()).toBe(200);
    const body = await respuesta.json();
    expect(body.idOrden).toBe("o1");
    expect(body.esDuplicado).toBe(true);
  });

  test("detecta como duplicado la segunda orden del mock (o2)", async ({ request }) => {
    const respuesta = await request.get("/pagos/o2/duplicado");
    const body = await respuesta.json();
    expect(body.esDuplicado).toBe(true);
  });

  test("no marca como duplicada una orden que no existe", async ({ request }) => {
    const respuesta = await request.get("/pagos/orden-nueva-e2e/duplicado");
    expect(respuesta.status()).toBe(200);
    const body = await respuesta.json();
    expect(body.esDuplicado).toBe(false);
  });

});
//

// Helper: genera un viajeId único por corrida, para no chocar con datos
// de corridas anteriores que ya quedaron guardados en la base real
function idUnico(sufijo: string): string {
  return `${sufijo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
// Requerimiento 7.2 - Método de pago
test.describe("RF-7.2 - Método de pago (POST y GET /metodo-pago)", () => {

  test("registra un método de pago y queda en estado 'pendiente'", async ({ request }) => {
    const viajeId = idUnico("e2e-metodo-1");
    const respuesta = await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-1", viajeId, tipo: "efectivo" },
    });
    expect(respuesta.status()).toBe(201);
    const body = await respuesta.json();
    expect(body.estado).toBe("pendiente");
    expect(body.tipo).toBe("efectivo");
  });

  test("acepta los tres tipos de pago válidos", async ({ request }) => {
    for (const tipo of ["efectivo", "tarjeta", "transferencia"]) {
      const respuesta = await request.post("/metodo-pago", {
        data: { clienteId: "cliente-e2e-2", viajeId: idUnico(`e2e-metodo-tipo-${tipo}`), tipo },
      });
      expect(respuesta.status()).toBe(201);
    }
  });

  test("devuelve 400 si faltan clienteId y viajeId", async ({ request }) => {
    const respuesta = await request.post("/metodo-pago", {
      data: { tipo: "efectivo" },
    });
    expect(respuesta.status()).toBe(400);
  });

  test("devuelve 400 si el tipo de pago no es válido", async ({ request }) => {
    const respuesta = await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-tipo", viajeId: idUnico("e2e-tipo-invalido"), tipo: "bitcoin" },
    });
    expect(respuesta.status()).toBe(400);
  });

  test("permite consultar un método de pago ya registrado", async ({ request }) => {
    const viajeId = idUnico("e2e-metodo-consulta");
    await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-3", viajeId, tipo: "tarjeta" },
    });

    const respuesta = await request.get(`/metodo-pago/${viajeId}`);
    expect(respuesta.status()).toBe(200);
    const body = await respuesta.json();
    expect(body.viajeId).toBe(viajeId);
    expect(body.tipo).toBe("tarjeta");
  });

  test("devuelve 404 al consultar un viaje sin método de pago", async ({ request }) => {
    const respuesta = await request.get(`/metodo-pago/${idUnico("viaje-inexistente-e2e")}`);
    expect(respuesta.status()).toBe(404);
  });

});

// Requerimiento 7.3 - Autorización y rechazo
test.describe("RF-7.3 - Autorización y rechazo (POST /metodo-pago/:viajeId/autorizar y /rechazar)", () => {

  test("flujo completo: registrar -> autorizar -> confirmar por GET", async ({ request }) => {
    const viajeId = idUnico("e2e-flujo-autorizar");

    const registro = await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-flujo1", viajeId, tipo: "efectivo" },
    });
    expect(registro.status()).toBe(201);
    const bodyRegistro = await registro.json();
    expect(bodyRegistro.estado).toBe("pendiente");

    const autorizacion = await request.post(`/metodo-pago/${viajeId}/autorizar`, {
      data: { idOrden: "orden-e2e-flujo-1", total: 1500 },
    });
    expect(autorizacion.status()).toBe(200);
    const bodyAutorizado = await autorizacion.json();
    expect(bodyAutorizado.estado).toBe("autorizado");
    expect(bodyAutorizado.paymentId).toBeTruthy();
    expect(bodyAutorizado.total).toBe(1500);
    expect(bodyAutorizado.moneda).toBe("ARS");

    const consulta = await request.get(`/metodo-pago/${viajeId}`);
    const bodyConsulta = await consulta.json();
    expect(bodyConsulta.estado).toBe("autorizado");
    expect(bodyConsulta.total).toBe(1500);
  });

  test("flujo completo: registrar -> rechazar -> confirmar por GET", async ({ request }) => {
    const viajeId = idUnico("e2e-flujo-rechazar");

    await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-flujo2", viajeId, tipo: "tarjeta" },
    });

    const rechazo = await request.post(`/metodo-pago/${viajeId}/rechazar`);
    expect(rechazo.status()).toBe(200);
    const bodyRechazo = await rechazo.json();
    expect(bodyRechazo.estado).toBe("rechazado");

    const consulta = await request.get(`/metodo-pago/${viajeId}`);
    const bodyConsulta = await consulta.json();
    expect(bodyConsulta.estado).toBe("rechazado");
  });

  test("devuelve 400 al autorizar un viaje sin método de pago", async ({ request }) => {
    const respuesta = await request.post(`/metodo-pago/${idUnico("viaje-sin-pago-e2e")}/autorizar`, {
      data: { idOrden: "orden-sin-pago", total: 1000 },
    });
    expect(respuesta.status()).toBe(400);
  });

  test("devuelve 400 al rechazar un viaje sin método de pago", async ({ request }) => {
    const respuesta = await request.post(`/metodo-pago/${idUnico("viaje-sin-pago-e2e-2")}/rechazar`);
    expect(respuesta.status()).toBe(400);
  });

  test("devuelve 400 si falta el total al autorizar", async ({ request }) => {
    const viajeId = idUnico("e2e-sin-total");
    await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-sintotal", viajeId, tipo: "efectivo" },
    });

    const respuesta = await request.post(`/metodo-pago/${viajeId}/autorizar`, {
      data: { idOrden: "orden-sin-total" },
    });
    expect(respuesta.status()).toBe(400);
  });

  test("devuelve 400 si falta el idOrden al autorizar", async ({ request }) => {
    const viajeId = idUnico("e2e-sin-orden");
    await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-sinorden", viajeId, tipo: "efectivo" },
    });

    const respuesta = await request.post(`/metodo-pago/${viajeId}/autorizar`, {
      data: { total: 1500 },
    });
    expect(respuesta.status()).toBe(400);
  });

  test("devuelve 400 al intentar autorizar un pago que ya fue autorizado", async ({ request }) => {
    const viajeId = idUnico("e2e-doble-autorizacion");
    await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-doble", viajeId, tipo: "efectivo" },
    });
    await request.post(`/metodo-pago/${viajeId}/autorizar`, {
      data: { idOrden: "orden-doble-1", total: 1000 },
    });

    const segundaVez = await request.post(`/metodo-pago/${viajeId}/autorizar`, {
      data: { idOrden: "orden-doble-2", total: 1000 },
    });
    expect(segundaVez.status()).toBe(400);
  });

  test("devuelve 400 al intentar rechazar un pago que ya fue autorizado", async ({ request }) => {
    const viajeId = idUnico("e2e-mix-estado");
    await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-mix", viajeId, tipo: "efectivo" },
    });
    await request.post(`/metodo-pago/${viajeId}/autorizar`, {
      data: { idOrden: "orden-mix", total: 1000 },
    });

    const rechazoTardio = await request.post(`/metodo-pago/${viajeId}/rechazar`);
    expect(rechazoTardio.status()).toBe(400);
  });

});

// Completo
// Completo
test.describe("Flujo de negocio completo (varios RF encadenados)", () => {

  test("un viaje se paga, se autoriza y luego se cancela con reintegro", async ({ request }) => {
    const viajeId = idUnico("e2e-viaje-completo");

    const registro = await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-completo", viajeId, tipo: "efectivo" },
    });
    expect(registro.status()).toBe(201);

    const autorizacion = await request.post(`/metodo-pago/${viajeId}/autorizar`, {
      data: { idOrden: "orden-viaje-completo", total: 2000 },
    });
    expect(autorizacion.status()).toBe(200);

    const reintegro = await request.post("/reintegro", {
      data: { montoCancelacion: 2000, viajeId },
    });
    expect(reintegro.status()).toBe(200);
    const bodyReintegro = await reintegro.json();
    expect(bodyReintegro.monto).toBe(1900);
  });

});
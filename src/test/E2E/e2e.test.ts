// src/test/E2E/m7Endpoints.e2e.test.ts
import { test, expect } from "@playwright/test";

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

test.describe("RF-7.2 - Método de pago (POST y GET /metodo-pago)", () => {

  test("registra un método de pago y queda en estado 'pendiente'", async ({ request }) => {
    const respuesta = await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-1", viajeId: "e2e-metodo-1", tipo: "efectivo" },
    });
    expect(respuesta.status()).toBe(201);
    const body = await respuesta.json();
    expect(body.estado).toBe("pendiente");
    expect(body.tipo).toBe("efectivo");
  });

  test("acepta los tres tipos de pago válidos", async ({ request }) => {
    for (const tipo of ["efectivo", "tarjeta", "transferencia"]) {
      const respuesta = await request.post("/metodo-pago", {
        data: { clienteId: "cliente-e2e-2", viajeId: `e2e-metodo-tipo-${tipo}`, tipo },
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

  test("permite consultar un método de pago ya registrado", async ({ request }) => {
    await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-3", viajeId: "e2e-metodo-consulta", tipo: "tarjeta" },
    });

    const respuesta = await request.get("/metodo-pago/e2e-metodo-consulta");
    expect(respuesta.status()).toBe(200);
    const body = await respuesta.json();
    expect(body.viajeId).toBe("e2e-metodo-consulta");
    expect(body.tipo).toBe("tarjeta");
  });

  test("devuelve 404 al consultar un viaje sin método de pago", async ({ request }) => {
    const respuesta = await request.get("/metodo-pago/viaje-inexistente-e2e");
    expect(respuesta.status()).toBe(404);
  });

});

test.describe("RF-7.3 - Autorización y rechazo (POST /metodo-pago/:viajeId/autorizar y /rechazar)", () => {

  test("flujo completo: registrar -> autorizar -> confirmar por GET", async ({ request }) => {
    const registro = await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-flujo1", viajeId: "e2e-flujo-autorizar", tipo: "efectivo" },
    });
    expect(registro.status()).toBe(201);
    const bodyRegistro = await registro.json();
    expect(bodyRegistro.estado).toBe("pendiente");

    const autorizacion = await request.post("/metodo-pago/e2e-flujo-autorizar/autorizar", {
      data: { idOrden: "orden-e2e-flujo-1" },
    });
    expect(autorizacion.status()).toBe(200);
    const bodyAutorizado = await autorizacion.json();
    expect(bodyAutorizado.estado).toBe("autorizado");

    const consulta = await request.get("/metodo-pago/e2e-flujo-autorizar");
    const bodyConsulta = await consulta.json();
    expect(bodyConsulta.estado).toBe("autorizado");
  });

  test("flujo completo: registrar -> rechazar -> confirmar por GET", async ({ request }) => {
    await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-flujo2", viajeId: "e2e-flujo-rechazar", tipo: "tarjeta" },
    });

    const rechazo = await request.post("/metodo-pago/e2e-flujo-rechazar/rechazar");
    expect(rechazo.status()).toBe(200);
    const bodyRechazo = await rechazo.json();
    expect(bodyRechazo.estado).toBe("rechazado");

    const consulta = await request.get("/metodo-pago/e2e-flujo-rechazar");
    const bodyConsulta = await consulta.json();
    expect(bodyConsulta.estado).toBe("rechazado");
  });

  test("devuelve 400 al autorizar un viaje sin método de pago", async ({ request }) => {
    const respuesta = await request.post("/metodo-pago/viaje-sin-pago-e2e/autorizar", {
      data: { idOrden: "orden-sin-pago" },
    });
    expect(respuesta.status()).toBe(400);
  });

  test("devuelve 400 al rechazar un viaje sin método de pago", async ({ request }) => {
    const respuesta = await request.post("/metodo-pago/viaje-sin-pago-e2e-2/rechazar");
    expect(respuesta.status()).toBe(400);
  });

  test("devuelve 400 al intentar autorizar un pago que ya fue autorizado", async ({ request }) => {
    await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-doble", viajeId: "e2e-doble-autorizacion", tipo: "efectivo" },
    });
    await request.post("/metodo-pago/e2e-doble-autorizacion/autorizar", {
      data: { idOrden: "orden-doble-1" },
    });

    const segundaVez = await request.post("/metodo-pago/e2e-doble-autorizacion/autorizar", {
      data: { idOrden: "orden-doble-2" },
    });
    expect(segundaVez.status()).toBe(400);
  });

  test("devuelve 400 al intentar rechazar un pago que ya fue autorizado", async ({ request }) => {
    await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-mix", viajeId: "e2e-mix-estado", tipo: "efectivo" },
    });
    await request.post("/metodo-pago/e2e-mix-estado/autorizar", {
      data: { idOrden: "orden-mix" },
    });

    const rechazoTardio = await request.post("/metodo-pago/e2e-mix-estado/rechazar");
    expect(rechazoTardio.status()).toBe(400);
  });

  test("no permite autorizar dos veces la misma orden de pago, aunque sean viajes distintos (idempotencia real)", async ({ request }) => {
    await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-idem", viajeId: "e2e-viaje-idem-1", tipo: "efectivo" },
    });
    await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-idem", viajeId: "e2e-viaje-idem-2", tipo: "efectivo" },
    });

    const primera = await request.post("/metodo-pago/e2e-viaje-idem-1/autorizar", {
      data: { idOrden: "orden-repetida-e2e" },
    });
    expect(primera.status()).toBe(200);

    const segunda = await request.post("/metodo-pago/e2e-viaje-idem-2/autorizar", {
      data: { idOrden: "orden-repetida-e2e" },
    });
    expect(segunda.status()).toBe(400);
  });

});

test.describe("Flujo de negocio completo (varios RF encadenados)", () => {

  test("un viaje se paga, se autoriza y luego se cancela con reintegro", async ({ request }) => {
    const registro = await request.post("/metodo-pago", {
      data: { clienteId: "cliente-e2e-completo", viajeId: "e2e-viaje-completo", tipo: "efectivo" },
    });
    expect(registro.status()).toBe(201);

    const autorizacion = await request.post("/metodo-pago/e2e-viaje-completo/autorizar", {
      data: { idOrden: "orden-viaje-completo" },
    });
    expect(autorizacion.status()).toBe(200);

    const reintegro = await request.post("/reintegro", {
      data: { montoCancelacion: 2000, viajeId: "e2e-viaje-completo" },
    });
    expect(reintegro.status()).toBe(200);
    const bodyReintegro = await reintegro.json();
    expect(bodyReintegro.monto).toBe(1900);
  });

});
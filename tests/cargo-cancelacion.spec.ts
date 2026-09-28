import { test, expect } from "@playwright/test";

test.describe("RF-7.4 - Cargo de cancelación", () => {

  test("1. Sin conductor asignado -> siempre gratis", async ({ request }) => {
    const response = await request.post("/tarifas/cancelacion", {
      data: {
        tripId: "trip_1",
        requestedBy: "cliente",
        vehicleType: "auto",
        tripStatus: "solicitado",
        estimatedFare: 5000
      }
    });

    expect(response.status()).toBe(200);

    const body = await response.json();

    expect(body.charge).toBe(0);
    expect(body.breakdown.ruleApplied).toBe("sin_conductor_asignado_sin_cargo");
  });


  test("2. Cancela el conductor -> nunca hay cargo al cliente", async ({ request }) => {
    const response = await request.post("/tarifas/cancelacion", {
      data: {
        tripId: "trip_2",
        requestedBy: "conductor",
        vehicleType: "auto",
        tripStatus: "asignado",
        estimatedFare: 5000,
        assignedAt: new Date().toISOString()
      }
    });

    expect(response.status()).toBe(200);

    const body = await response.json();

    expect(body.charge).toBe(0);
    expect(body.breakdown.ruleApplied).toBe("cancelacion_por_conductor_sin_cargo_a_cliente");
  });


  test("3. Cliente cancela dentro del período de gracia -> sin cargo", async ({ request }) => {
    const assignedAt = new Date(Date.now() - 10_000).toISOString(); // hace 10s

    const response = await request.post("/tarifas/cancelacion", {
      data: {
        tripId: "trip_3",
        requestedBy: "cliente",
        vehicleType: "auto",
        tripStatus: "asignado",
        estimatedFare: 5000,
        assignedAt
      }
    });

    expect(response.status()).toBe(200);

    const body = await response.json();

    expect(body.charge).toBe(0);
    expect(body.breakdown.ruleApplied).toBe("dentro_de_periodo_de_gracia");
  });


  test("4. Cliente cancela post-asignación fuera del período de gracia -> aplica clamp máximo", async ({ request }) => {
    const assignedAt = new Date(Date.now() - 200_000).toISOString(); // hace 200s

    const response = await request.post("/tarifas/cancelacion", {
      data: {
        tripId: "trip_4",
        requestedBy: "cliente",
        vehicleType: "auto",
        tripStatus: "asignado",
        estimatedFare: 10000, // 10000 * 0.2 = 2000 -> clamp a 1500
        assignedAt
      }
    });

    expect(response.status()).toBe(200);

    const body = await response.json();

    expect(body.charge).toBe(1500);
    expect(body.breakdown.ruleApplied).toBe("cliente_cancela_post_asignacion");
  });


  test("5. Cliente cancela con conductor arribado -> aplica clamp máximo", async ({ request }) => {
    const response = await request.post("/tarifas/cancelacion", {
      data: {
        tripId: "trip_5",
        requestedBy: "cliente",
        vehicleType: "auto",
        tripStatus: "arribado",
        estimatedFare: 10000 // 10000 * 0.5 = 5000 -> clamp a 3000
      }
    });

    expect(response.status()).toBe(200);

    const body = await response.json();

    expect(body.charge).toBe(3000);
    expect(body.breakdown.ruleApplied).toBe("cliente_cancela_con_conductor_en_camino_o_arribado");
  });


  test("6. Rechazar cancelación de un viaje en estado no cancelable", async ({ request }) => {
    const response = await request.post("/tarifas/cancelacion", {
      data: {
        tripId: "trip_6",
        requestedBy: "cliente",
        vehicleType: "auto",
        tripStatus: "en_curso",
        estimatedFare: 5000
      }
    });

    expect(response.status()).toBe(409);

    const body = await response.json();

    expect(body.error).toContain("No se puede calcular un cargo de cancelacion");
  });


  test("7. Rechazar cuando falta tripId", async ({ request }) => {
    const response = await request.post("/tarifas/cancelacion", {
      data: {
        requestedBy: "cliente",
        vehicleType: "auto",
        tripStatus: "solicitado",
        estimatedFare: 5000
      }
    });

    expect(response.status()).toBe(400);

    const body = await response.json();

    expect(body.error).toBe("tripId es obligatorio");
  });


  test("8. Rechazar cuando vehicleType no es válido", async ({ request }) => {
    const response = await request.post("/tarifas/cancelacion", {
      data: {
        tripId: "trip_8",
        requestedBy: "cliente",
        vehicleType: "bicicleta",
        tripStatus: "solicitado",
        estimatedFare: 5000
      }
    });

    expect(response.status()).toBe(400);

    const body = await response.json();

    expect(body.error).toBe("vehicleType debe ser 'auto' o 'moto'");
  });

});
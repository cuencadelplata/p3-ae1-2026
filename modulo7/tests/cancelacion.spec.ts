
import { test, expect } from "@playwright/test";

test.describe("RF-7.4 - Cargo de cancelación", () => {
  test("1. Sin conductor asignado -> siempre sin cargo", async ({ request }) => {
    const response = await request.post("/cancelacion/cargo", {
      data: {
        tripId: "trip_1",
        requestedBy: "cliente",
        vehicleType: "auto",
        tripStatus: "solicitado",
        estimatedFare: 5000,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.charge).toBe(0);
    expect(body.breakdown.ruleApplied).toBe("sin_conductor_asignado_sin_cargo");
  });

  test("2. Cancela el conductor -> nunca hay cargo al cliente", async ({ request }) => {
    const response = await request.post("/cancelacion/cargo", {
      data: {
        tripId: "trip_2",
        requestedBy: "conductor",
        vehicleType: "auto",
        tripStatus: "asignado",
        estimatedFare: 5000,
        assignedAt: new Date().toISOString(),
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.charge).toBe(0);
    expect(body.breakdown.ruleApplied).toBe("cancelacion_por_conductor_sin_cargo_a_cliente");
  });

  test("3. Conductor en camino -> cobra 50% de la tarifa con clamp", async ({ request }) => {
    const response = await request.post("/cancelacion/cargo", {
      data: {
        tripId: "trip_3",
        requestedBy: "cliente",
        vehicleType: "auto",
        tripStatus: "conductor_en_camino",
        estimatedFare: 2000,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.charge).toBe(1000); // 50% de 2000 = 1000
    expect(body.breakdown.ruleApplied).toBe("cliente_cancela_con_conductor_en_camino_o_arribado");
  });
});

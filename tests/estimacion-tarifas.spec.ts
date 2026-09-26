import { test, expect } from "@playwright/test";

test.describe("RF-7.1 - Estimación de tarifa", () => {

  test("1. Calcular una estimación válida con auto", async ({ request }) => {
    const response = await request.post("/tarifas/estimacion", {
      data: {
        origen: { lat: -27.4692, lng: -58.8306 },
        destino: { lat: -27.48, lng: -58.84 },
        distanciaKm: 10,
        tiempoEstimadoMin: 20,
        vehicleType: "auto"
      }
    });

    expect(response.status()).toBe(200);

    const body = await response.json();

    // tarifaBase 500 + distancia (10*250=2500) + tiempo (20*50=1000) = 4000, x1.0
    expect(body.estimatedFare).toBe(4000);
    expect(body.currency).toBe("ARS");
    expect(body.desglose.multiplicadorVehiculo).toBe(1.0);
  });


  test("2. Calcular una estimación válida con moto (aplica multiplicador 0.7)", async ({ request }) => {
    const response = await request.post("/tarifas/estimacion", {
      data: {
        origen: { lat: -27.4692, lng: -58.8306 },
        destino: { lat: -27.48, lng: -58.84 },
        distanciaKm: 10,
        tiempoEstimadoMin: 20,
        vehicleType: "moto"
      }
    });

    expect(response.status()).toBe(200);

    const body = await response.json();

    // (500 + 2500 + 1000) * 0.7 = 2800
    expect(body.estimatedFare).toBe(2800);
    expect(body.desglose.multiplicadorVehiculo).toBe(0.7);
  });


  test("3. Rechazar cuando distanciaKm no es válida", async ({ request }) => {
    const response = await request.post("/tarifas/estimacion", {
      data: {
        distanciaKm: 0,
        tiempoEstimadoMin: 20,
        vehicleType: "auto"
      }
    });

    expect(response.status()).toBe(400);

    const body = await response.json();

    expect(body.error).toBe("distanciaKm debe ser un número mayor a 0");
  });


  test("4. Rechazar cuando tiempoEstimadoMin no es válido", async ({ request }) => {
    const response = await request.post("/tarifas/estimacion", {
      data: {
        distanciaKm: 10,
        tiempoEstimadoMin: -5,
        vehicleType: "auto"
      }
    });

    expect(response.status()).toBe(400);

    const body = await response.json();

    expect(body.error).toBe("tiempoEstimadoMin debe ser un número mayor a 0");
  });


  test("5. Rechazar cuando vehicleType no es válido", async ({ request }) => {
    const response = await request.post("/tarifas/estimacion", {
      data: {
        distanciaKm: 10,
        tiempoEstimadoMin: 20,
        vehicleType: "bicicleta"
      }
    });

    expect(response.status()).toBe(400);

    const body = await response.json();

    expect(body.error).toBe("vehicleType debe ser 'auto' o 'moto'");
  });

});
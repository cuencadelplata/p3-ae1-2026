import { test, expect } from "@playwright/test";

test.describe("RF-7.7 - Historial financiero", () => {
  test("1. Consultar historial inicialmente", async ({ request }) => {
    const response = await request.get("/operations");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("2. Registrar una operación válida", async ({ request }) => {
    const response = await request.post("/operations", {
      data: {
        type: "payment",
        amount: 1500,
      },
    });
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.mensaje).toBe("Operación creada");
  });

  test("3. Rechazar una operación cuando amount no es un número", async ({ request }) => {
    const response = await request.post("/operations", {
      data: {
        type: "payment",
        amount: "1500",
      },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("El campo amount debe ser un número");
  });

  test("4. Rechazar una operación cuando type no es válido", async ({ request }) => {
    const response = await request.post("/operations", {
      data: {
        type: "invalid",
        amount: 1500,
      },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("El campo type no es válido");
  });
});

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
        amount: 1500
      }
    });

    expect(response.status()).toBe(201);

    const body = await response.json();

    expect(body.mensaje).toBe("Operación creada");
  });


  test("3. Rechazar una operación cuando amount no es un número", async ({ request }) => {
    const response = await request.post("/operations", {
      data: {
        type: "payment",
        amount: "1500"
      }
    });

    expect(response.status()).toBe(400);

    const body = await response.json();

    expect(body.error).toBe("El campo amount debe ser un número");
  });


  test("4. Rechazar una operación cuando type no es válido", async ({ request }) => {
    const response = await request.post("/operations", {
      data: {
        type: "invalid",
        amount: 1500
      }
    });

    expect(response.status()).toBe(400);

    const body = await response.json();

    expect(body.error).toBe("El campo type no es válido");
  });


  test("5. Registrar una operación y verificar que aparezca en el historial", async ({ request }) => {

    await request.post("/operations", {
      data: {
        type: "payment",
        amount: 2500
      }
    });

    const response = await request.get("/operations");

    expect(response.status()).toBe(200);

    const operations = await response.json();

    expect(Array.isArray(operations)).toBe(true);

    const operation = operations.find(
      (op: any) =>
        op.type === "payment" &&
        op.amount === 2500
    );

    expect(operation).toBeDefined();
    expect(operation.status).toBe("pending");
  });


  test("6. Actualizar el estado de una operación", async ({ request }) => {

    const createResponse = await request.post("/operations", {
      data: {
        type: "payment",
        amount: 3000
      }
    });

    expect(createResponse.status()).toBe(201);

    const operationsResponse = await request.get("/operations");

    const operations = await operationsResponse.json();

    const operation = operations.find(
      (op: any) =>
        op.type === "payment" &&
        op.amount === 3000
    );

    expect(operation).toBeDefined();

    const updateResponse = await request.patch(
      `/operations/${operation.id}/status`,
      {
        data: {
          status: "completed"
        }
      }
    );

    expect(updateResponse.status()).toBe(200);

    const updatedOperation = await updateResponse.json();

    expect(updatedOperation.id).toBe(operation.id);
    expect(updatedOperation.status).toBe("completed");
  });


  test("7. Rechazar un estado inválido", async ({ request }) => {

    const createResponse = await request.post("/operations", {
      data: {
        type: "payment",
        amount: 4000
      }
    });

    expect(createResponse.status()).toBe(201);

    const operationsResponse = await request.get("/operations");

    const operations = await operationsResponse.json();

    const operation = operations.find(
      (op: any) =>
        op.type === "payment" &&
        op.amount === 4000
    );

    expect(operation).toBeDefined();

    const response = await request.patch(
      `/operations/${operation.id}/status`,
      {
        data: {
          status: "invalid"
        }
      }
    );

    expect(response.status()).toBe(400);

    const body = await response.json();

    expect(body.error).toBe("El nuevo estado no es válido");
  });


  test("8. Actualizar una operación inexistente", async ({ request }) => {

    const response = await request.patch(
      "/operations/op_inexistente/status",
      {
        data: {
          status: "completed"
        }
      }
    );

    expect(response.status()).toBe(404);

    const body = await response.json();

    expect(body.error).toBe("Operación no encontrada");
  });

});
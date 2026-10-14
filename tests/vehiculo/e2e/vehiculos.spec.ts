import { test, expect } from "@playwright/test";

// Cada test usa su propio driverId único, para no chocar entre corridas
// ni depender del orden en que se ejecutan.
function driverIdUnico() {
  return `driver-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

// Genera una patente válida y distinta en cada llamada (formato AAA000),
// para no toparse con el unique de la base entre tests.
function patenteUnica() {
  const n = Date.now() % 1000;
  return `ZZZ${n.toString().padStart(3, "0")}`;
}

test.describe("POST /drivers/:driverId/vehicles — RF-3.2 registrar vehículo", () => {
  test("registra un vehículo válido y devuelve 201 con el objeto creado", async ({
    request,
  }) => {
    const driverId = driverIdUnico();
    const patente = patenteUnica();

    const response = await request.post(
      `/api/v1/drivers/${driverId}/vehicles`,
      {
        data: { patente, tipoServicio: "AUTO", anio: 2020 },
      },
    );

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.id).toBeTruthy();
    expect(body.driverId).toBe(driverId);
    expect(body.patente).toBe(patente);
    expect(body.tipoServicio).toBe("AUTO");
    expect(body.activo).toBe(false);
  });

  test("rechaza con 400 si falta la patente", async ({ request }) => {
    const response = await request.post(
      `/api/v1/drivers/${driverIdUnico()}/vehicles`,
      { data: { tipoServicio: "AUTO", anio: 2020 } },
    );

    expect(response.status()).toBe(400);
  });

  test("rechaza con 400 si la patente tiene formato inválido", async ({
    request,
  }) => {
    const response = await request.post(
      `/api/v1/drivers/${driverIdUnico()}/vehicles`,
      { data: { patente: "NOVALIDA", tipoServicio: "AUTO", anio: 2020 } },
    );

    expect(response.status()).toBe(400);
  });

  test("rechaza con 400 si tipoServicio no es AUTO ni MOTO", async ({
    request,
  }) => {
    const response = await request.post(
      `/api/v1/drivers/${driverIdUnico()}/vehicles`,
      {
        data: {
          patente: patenteUnica(),
          tipoServicio: "CAMIONETA",
          anio: 2020,
        },
      },
    );

    expect(response.status()).toBe(400);
  });

  test("rechaza con 409 si la patente ya está registrada", async ({
    request,
  }) => {
    const patente = patenteUnica();

    // Primera vez: se crea sin problema
    const primera = await request.post(
      `/api/v1/drivers/${driverIdUnico()}/vehicles`,
      { data: { patente, tipoServicio: "AUTO", anio: 2020 } },
    );
    expect(primera.status()).toBe(201);

    // Segunda vez, misma patente, otro conductor: debe rechazarse
    const segunda = await request.post(
      `/api/v1/drivers/${driverIdUnico()}/vehicles`,
      { data: { patente, tipoServicio: "MOTO", anio: 2021 } },
    );
    expect(segunda.status()).toBe(409);
  });
});

test.describe("GET /drivers/:driverId/vehicles — listar y obtener", () => {
  test("lista los vehículos del conductor recién creado", async ({
    request,
  }) => {
    const driverId = driverIdUnico();
    await request.post(`/api/v1/drivers/${driverId}/vehicles`, {
      data: { patente: patenteUnica(), tipoServicio: "AUTO", anio: 2020 },
    });

    const response = await request.get(
      `/api/v1/drivers/${driverId}/vehicles`,
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  test("obtiene un vehículo puntual por id", async ({ request }) => {
    const driverId = driverIdUnico();
    const creado = await request.post(
      `/api/v1/drivers/${driverId}/vehicles`,
      { data: { patente: patenteUnica(), tipoServicio: "AUTO", anio: 2020 } },
    );
    const { id } = await creado.json();

    const response = await request.get(
      `/api/v1/drivers/${driverId}/vehicles/${id}`,
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(id);
  });

  test("devuelve 404 si el vehículo no existe para ese conductor", async ({
    request,
  }) => {
    const response = await request.get(
      `/api/v1/drivers/${driverIdUnico()}/vehicles/00000000-0000-0000-0000-000000000000`,
    );

    expect(response.status()).toBe(404);
  });
});

test.describe("PATCH /drivers/:driverId/vehicles/:vehicleId/activar", () => {
  test("activa un vehículo existente", async ({ request }) => {
    const driverId = driverIdUnico();
    const creado = await request.post(
      `/api/v1/drivers/${driverId}/vehicles`,
      { data: { patente: patenteUnica(), tipoServicio: "AUTO", anio: 2020 } },
    );
    const { id } = await creado.json();

    const response = await request.patch(
      `/api/v1/drivers/${driverId}/vehicles/${id}/activar`,
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.activo).toBe(true);
  });

  test("devuelve 404 al activar un vehículo inexistente", async ({
    request,
  }) => {
    const response = await request.patch(
      `/api/v1/drivers/${driverIdUnico()}/vehicles/00000000-0000-0000-0000-000000000000/activar`,
    );

    expect(response.status()).toBe(404);
  });
});
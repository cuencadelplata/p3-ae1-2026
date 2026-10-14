import { test, expect } from "@playwright/test";

// Mismos helpers que ya usás en vehiculos.spec.ts
function driverIdUnico() {
  return `driver-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function patenteUnica() {
  const n = Date.now() % 1000;
  return `ZZZ${n.toString().padStart(3, "0")}`;
}

// Genera una key de idempotencia distinta en cada llamada al helper,
// pero la reusamos DENTRO de un mismo test para simular un reintento.
function idempotencyKeyUnica() {
  return `idem-test-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

test.describe("Idempotencia en POST /vehicles (Redis)", () => {
  test("dos POST con la misma Idempotency-Key devuelven el mismo vehículo, sin duplicar", async ({
    request,
  }) => {
    const driverId = driverIdUnico();
    const patente = patenteUnica();
    const idempotencyKey = idempotencyKeyUnica();
    const body = { patente, tipoServicio: "AUTO", anio: 2020 };

    // Primer pedido: se crea normalmente
    const primera = await request.post(
      `/api/v1/drivers/${driverId}/vehicles`,
      {
        data: body,
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
    expect(primera.status()).toBe(201);
    const primerBody = await primera.json();

    // Segundo pedido: mismo body, misma key → reintento
    const segunda = await request.post(
      `/api/v1/drivers/${driverId}/vehicles`,
      {
        data: body,
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
    expect(segunda.status()).toBe(201);
    const segundoBody = await segunda.json();

    // Tiene que ser EXACTAMENTE el mismo vehículo (mismo id y mismo createdAt),
    // no uno nuevo con datos iguales.
    expect(segundoBody.id).toBe(primerBody.id);
    expect(segundoBody.createdAt).toBe(primerBody.createdAt);

    // Confirmamos que en la base quedó un solo vehículo para ese conductor
    const listado = await request.get(
      `/api/v1/drivers/${driverId}/vehicles`,
    );
    const vehiculos = await listado.json();
    expect(vehiculos.length).toBe(1);
  });

  test("dos POST sin Idempotency-Key crean vehículos distintos", async ({
    request,
  }) => {
    const driverId = driverIdUnico();

    const primera = await request.post(
      `/api/v1/drivers/${driverId}/vehicles`,
      { data: { patente: patenteUnica(), tipoServicio: "AUTO", anio: 2020 } },
    );
    expect(primera.status()).toBe(201);
    const primerBody = await primera.json();

    const segunda = await request.post(
      `/api/v1/drivers/${driverId}/vehicles`,
      { data: { patente: patenteUnica(), tipoServicio: "MOTO", anio: 2021 } },
    );
    expect(segunda.status()).toBe(201);
    const segundoBody = await segunda.json();

    // Sin key, cada POST es independiente: ids distintos
    expect(segundoBody.id).not.toBe(primerBody.id);

    const listado = await request.get(
      `/api/v1/drivers/${driverId}/vehicles`,
    );
    const vehiculos = await listado.json();
    expect(vehiculos.length).toBe(2);
  });
});
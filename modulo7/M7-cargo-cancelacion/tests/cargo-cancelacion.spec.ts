import { test, expect } from "@playwright/test";

/**
 * Simulacion del funcionamiento de RF-7.4 (Cargo de cancelacion) usando
 * Playwright en modo API testing (sin navegador, solo peticiones HTTP).
 *
 * Requiere que la API este corriendo (local o en el contenedor Docker)
 * en la URL configurada como baseURL en playwright.config.ts.
 */

function isoSecondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

const ENDPOINT = "/api/m7/cargo-cancelacion";

test("1) sin conductor asignado -> gratis", async ({ request }) => {
  const resp = await request.post(ENDPOINT, {
    data: {
      tripId: "trip-001",
      requestedBy: "cliente",
      vehicleType: "auto",
      tripStatus: "solicitado",
      estimatedFare: 4000,
    },
  });
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.charge).toBe(0);
  expect(body.breakdown.ruleApplied).toBe("sin_conductor_asignado_sin_cargo");
});

test("2) dentro del periodo de gracia (30s) -> gratis", async ({ request }) => {
  const resp = await request.post(ENDPOINT, {
    data: {
      tripId: "trip-002",
      requestedBy: "cliente",
      vehicleType: "auto",
      tripStatus: "asignado",
      estimatedFare: 4000,
      assignedAt: isoSecondsAgo(30),
    },
  });
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.charge).toBe(0);
  expect(body.breakdown.ruleApplied).toBe("dentro_de_periodo_de_gracia");
});

test("3) pasado el periodo de gracia (5 min) en Auto -> cargo 20%", async ({ request }) => {
  const resp = await request.post(ENDPOINT, {
    data: {
      tripId: "trip-003",
      requestedBy: "cliente",
      vehicleType: "auto",
      tripStatus: "asignado",
      estimatedFare: 4000,
      assignedAt: isoSecondsAgo(300),
    },
  });
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.charge).toBe(800); // 4000 * 0.20
  expect(body.breakdown.ruleApplied).toBe("cliente_cancela_post_asignacion");
});

test("4) igual al anterior pero en Moto -> cargo 20% * 0.7", async ({ request }) => {
  const resp = await request.post(ENDPOINT, {
    data: {
      tripId: "trip-004",
      requestedBy: "cliente",
      vehicleType: "moto",
      tripStatus: "asignado",
      estimatedFare: 4000,
      assignedAt: isoSecondsAgo(300),
    },
  });
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.charge).toBe(560); // 4000 * 0.20 * 0.7
});

test("5) conductor ya arribado -> cargo 50% (con techo)", async ({ request }) => {
  const resp = await request.post(ENDPOINT, {
    data: {
      tripId: "trip-005",
      requestedBy: "cliente",
      vehicleType: "auto",
      tripStatus: "arribado",
      estimatedFare: 10000,
      assignedAt: isoSecondsAgo(600),
      arrivedAt: isoSecondsAgo(60),
    },
  });
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.charge).toBe(3000); // 10000 * 0.50 = 5000, pero el techo es 3000
});

test("6) cancela el conductor -> sin cargo al cliente", async ({ request }) => {
  const resp = await request.post(ENDPOINT, {
    data: {
      tripId: "trip-006",
      requestedBy: "conductor",
      vehicleType: "auto",
      tripStatus: "conductor_en_camino",
      estimatedFare: 4000,
      assignedAt: isoSecondsAgo(200),
    },
  });
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.charge).toBe(0);
  expect(body.breakdown.ruleApplied).toBe("cancelacion_por_conductor_sin_cargo_a_cliente");
});

test("7) viaje ya completado -> error de negocio (409)", async ({ request }) => {
  const resp = await request.post(ENDPOINT, {
    data: {
      tripId: "trip-007",
      requestedBy: "cliente",
      vehicleType: "auto",
      tripStatus: "completado",
      estimatedFare: 4000,
    },
  });
  expect(resp.status()).toBe(409);
});

test("8) payload invalido (tarifa negativa) -> error de validacion (400)", async ({ request }) => {
  const resp = await request.post(ENDPOINT, {
    data: {
      tripId: "trip-008",
      requestedBy: "cliente",
      vehicleType: "auto",
      tripStatus: "asignado",
      estimatedFare: -100,
      assignedAt: isoSecondsAgo(300),
    },
  });
  expect(resp.status()).toBe(400);
});
import { test, expect } from "@playwright/test";

function driverIdUnico() {
  return `driver-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function patenteUnica() {
  const n = Date.now() % 1000;
  return `ZZ${n.toString().padStart(3, "0")}ZZ`;
}

// La fecha de vencimiento tiene que ser futura, así que la generamos
// siempre a un año desde hoy.
function fechaFutura() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split("T")[0];
}

function fechaPasada() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().split("T")[0];
}

// Crea un vehículo de prueba para el conductor y devuelve su id,
// necesario para probar documentos que requieren vehicleId
// (SEGURO_VEHICULO, CEDULA_VEHICULO).
async function crearVehiculoDePrueba(request: any, driverId: string) {
  const response = await request.post(
    `/api/v1/drivers/${driverId}/vehicles`,
    { data: { patente: patenteUnica(), tipoServicio: "AUTO", anio: 2020 } },
  );
  const body = await response.json();
  return body.id as string;
}

test.describe("POST /drivers/:driverId/documents — RF-3.4 registrar documentación", () => {
  test("registra una LICENCIA_CONDUCIR válida (sin vehicleId) y devuelve 201", async ({
    request,
  }) => {
    const driverId = driverIdUnico();

    const response = await request.post(
      `/api/v1/drivers/${driverId}/documents`,
      {
        data: {
          tipoDocumento: "LICENCIA_CONDUCIR",
          numeroDocumento: "LIC-001",
          fechaVencimiento: fechaFutura(),
          archivoUrl: "https://ejemplo.com/licencia.pdf",
        },
      },
    );

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.id).toBeTruthy();
    expect(body.tipoDocumento).toBe("LICENCIA_CONDUCIR");
    expect(body.vehicleId).toBeNull();
    expect(body.estado).toBe("PENDIENTE");
  });

  test("registra un SEGURO_VEHICULO válido (con vehicleId) y devuelve 201", async ({
    request,
  }) => {
    const driverId = driverIdUnico();
    const vehicleId = await crearVehiculoDePrueba(request, driverId);

    const response = await request.post(
      `/api/v1/drivers/${driverId}/documents`,
      {
        data: {
          tipoDocumento: "SEGURO_VEHICULO",
          numeroDocumento: "POL-001",
          fechaVencimiento: fechaFutura(),
          archivoUrl: "https://ejemplo.com/seguro.pdf",
          vehicleId,
        },
      },
    );

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.vehicleId).toBe(vehicleId);
  });

  test("rechaza con 400 si el tipoDocumento no es válido", async ({
    request,
  }) => {
    const response = await request.post(
      `/api/v1/drivers/${driverIdUnico()}/documents`,
      {
        data: {
          tipoDocumento: "CARNET_DE_CLUB",
          numeroDocumento: "X-1",
          fechaVencimiento: fechaFutura(),
          archivoUrl: "https://ejemplo.com/x.pdf",
        },
      },
    );

    expect(response.status()).toBe(400);
  });

  test("rechaza con 400 si falta numeroDocumento", async ({ request }) => {
    const response = await request.post(
      `/api/v1/drivers/${driverIdUnico()}/documents`,
      {
        data: {
          tipoDocumento: "LICENCIA_CONDUCIR",
          fechaVencimiento: fechaFutura(),
          archivoUrl: "https://ejemplo.com/x.pdf",
        },
      },
    );

    expect(response.status()).toBe(400);
  });

  test("rechaza con 400 si falta archivoUrl", async ({ request }) => {
    const response = await request.post(
      `/api/v1/drivers/${driverIdUnico()}/documents`,
      {
        data: {
          tipoDocumento: "LICENCIA_CONDUCIR",
          numeroDocumento: "LIC-002",
          fechaVencimiento: fechaFutura(),
        },
      },
    );

    expect(response.status()).toBe(400);
  });

  test("rechaza con 400 si la fecha de vencimiento ya pasó", async ({
    request,
  }) => {
    const response = await request.post(
      `/api/v1/drivers/${driverIdUnico()}/documents`,
      {
        data: {
          tipoDocumento: "LICENCIA_CONDUCIR",
          numeroDocumento: "LIC-003",
          fechaVencimiento: fechaPasada(),
          archivoUrl: "https://ejemplo.com/x.pdf",
        },
      },
    );

    expect(response.status()).toBe(400);
  });

  test("rechaza con 400 un SEGURO_VEHICULO sin vehicleId", async ({
    request,
  }) => {
    const response = await request.post(
      `/api/v1/drivers/${driverIdUnico()}/documents`,
      {
        data: {
          tipoDocumento: "SEGURO_VEHICULO",
          numeroDocumento: "POL-002",
          fechaVencimiento: fechaFutura(),
          archivoUrl: "https://ejemplo.com/seguro.pdf",
        },
      },
    );

    expect(response.status()).toBe(400);
  });

  test("rechaza con 400 una LICENCIA_CONDUCIR con vehicleId", async ({
    request,
  }) => {
    const driverId = driverIdUnico();
    const vehicleId = await crearVehiculoDePrueba(request, driverId);

    const response = await request.post(
      `/api/v1/drivers/${driverId}/documents`,
      {
        data: {
          tipoDocumento: "LICENCIA_CONDUCIR",
          numeroDocumento: "LIC-004",
          fechaVencimiento: fechaFutura(),
          archivoUrl: "https://ejemplo.com/x.pdf",
          vehicleId,
        },
      },
    );

    expect(response.status()).toBe(400);
  });

  test("rechaza con 404 si el vehicleId no existe para ese conductor", async ({
    request,
  }) => {
    const response = await request.post(
      `/api/v1/drivers/${driverIdUnico()}/documents`,
      {
        data: {
          tipoDocumento: "SEGURO_VEHICULO",
          numeroDocumento: "POL-003",
          fechaVencimiento: fechaFutura(),
          archivoUrl: "https://ejemplo.com/seguro.pdf",
          vehicleId: "00000000-0000-0000-0000-000000000000",
        },
      },
    );

    expect(response.status()).toBe(404);
  });
});

test.describe("GET /drivers/:driverId/documents — listar y obtener", () => {
  test("lista los documentos del conductor recién creado", async ({
    request,
  }) => {
    const driverId = driverIdUnico();
    await request.post(`/api/v1/drivers/${driverId}/documents`, {
      data: {
        tipoDocumento: "LICENCIA_CONDUCIR",
        numeroDocumento: "LIC-005",
        fechaVencimiento: fechaFutura(),
        archivoUrl: "https://ejemplo.com/x.pdf",
      },
    });

    const response = await request.get(
      `/api/v1/drivers/${driverId}/documents`,
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  test("obtiene un documento puntual por id", async ({ request }) => {
    const driverId = driverIdUnico();
    const creado = await request.post(
      `/api/v1/drivers/${driverId}/documents`,
      {
        data: {
          tipoDocumento: "LICENCIA_CONDUCIR",
          numeroDocumento: "LIC-006",
          fechaVencimiento: fechaFutura(),
          archivoUrl: "https://ejemplo.com/x.pdf",
        },
      },
    );
    const { id } = await creado.json();

    const response = await request.get(
      `/api/v1/drivers/${driverId}/documents/${id}`,
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(id);
  });

  test("devuelve 404 si el documento no existe para ese conductor", async ({
    request,
  }) => {
    const response = await request.get(
      `/api/v1/drivers/${driverIdUnico()}/documents/00000000-0000-0000-0000-000000000000`,
    );

    expect(response.status()).toBe(404);
  });
});
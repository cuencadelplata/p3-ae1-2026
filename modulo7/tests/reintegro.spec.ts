import { test, expect } from "@playwright/test";

const RABBITMQ_API = "http://localhost:15672/api";
const RABBITMQ_USER = "guest";
const RABBITMQ_PASS = "guest";
const EXCHANGE = "viajes";
const ROUTING_KEY = "cancelacion_cliente";

function nuevoId(): string {
  return `viaje-test-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function publicarEventoM6(request: any, viajeId: string): Promise<boolean> {
  const mensaje = {
    vhost: "/",
    name: EXCHANGE,
    properties: { delivery_mode: 2, content_type: "application/json" },
    routing_key: ROUTING_KEY,
    payload: JSON.stringify({
      viajeId,
      idOrden: `orden-${viajeId}`,
      montoCancelacion: 1000,
      evento: "cancelacion_cliente",
    }),
    payload_encoding: "string",
  };

  const response = await fetch(
    `${RABBITMQ_API}/exchanges/%2F/${EXCHANGE}/publish`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + btoa(`${RABBITMQ_USER}:${RABBITMQ_PASS}`),
      },
      body: JSON.stringify(mensaje),
    }
  );

  if (!response.ok) return false;
  const json = await response.json();
  return json.routed === true;
}

async function esDuplicado(request: any, viajeId: string): Promise<boolean> {
  const response = await request.get(`/pagos/${viajeId}/duplicado`);
  if (!response.ok()) return false;
  const body = await response.json();
  return body.esDuplicado === true;
}

test.describe("RF-7.5 - Reintegro por cancelación", () => {
  test("1. E2E: evento M6 → consumer guarda reintegro → idempotencia verificada", async ({ request }) => {
    const viajeId = nuevoId();

    const publicado = await publicarEventoM6(request, viajeId);
    expect(publicado, "El evento debe ser enrutado por RabbitMQ").toBe(true);

    let duplicado = false;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        duplicado = await esDuplicado(request, viajeId);
        if (duplicado) break;
      } catch {}
    }

    expect(duplicado, "El reintegro debe estar guardado en BD").toBe(true);
  });

  test("2. Idempotencia: publicar el mismo evento dos veces no duplica el reintegro", async ({ request }) => {
    const viajeId = nuevoId();

    await publicarEventoM6(request, viajeId);

    let guardado = false;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      guardado = await esDuplicado(request, viajeId);
      if (guardado) break;
    }
    expect(guardado, "Primera publicación debe guardarse").toBe(true);

    await publicarEventoM6(request, viajeId);
    await new Promise((r) => setTimeout(r, 2000));

    const aun = await esDuplicado(request, viajeId);
    expect(aun, "Idempotencia debe mantenerse").toBe(true);
  });
});

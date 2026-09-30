import { test, expect, type APIRequestContext } from "@playwright/test";
import { execSync } from "node:child_process";

const RABBIT = process.env.RABBIT_API ?? "http://localhost:15672";
const AUTH = "Basic " + Buffer.from("guest:guest").toString("base64");
const HEADERS = { Authorization: AUTH };

const nuevoId = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function docker(cmd: string) {
  execSync(`docker compose ${cmd}`, { stdio: "inherit" });
}

// Payload real que publica M6 (Lucas)
const eventoCancelacion = (viajeId: string, evento: "cancelacion_cliente" | "despacho.reabrir") => ({
  viajeId,
  clienteId: `C-${viajeId}`,
  conductorId: `D-${viajeId}`,
  motivo: "prueba resiliencia",
  evento,
  timestamp: new Date().toISOString(),
});

async function publicar(
  request: APIRequestContext,
  viajeId: string,
  evento: "cancelacion_cliente" | "despacho.reabrir" = "cancelacion_cliente"
) {
  const r = await request.post(`${RABBIT}/api/exchanges/%2F/viajes/publish`, {
    headers: HEADERS,
    data: {
      properties: {},
      routing_key: evento,
      payload: JSON.stringify(eventoCancelacion(viajeId, evento)),
      payload_encoding: "string",
    },
  });
  return (await r.json()).routed === true;
}

const esDuplicado = async (request: APIRequestContext, viajeId: string) =>
  (await (await request.get(`/pagos/${viajeId}/duplicado`)).json()).esDuplicado;

// Siempre dejamos todo prendido al terminar, pase lo que pase
test.afterEach(() => {
  docker("start redis rabbitmq");
});

test.describe("Resiliencia ante caída de backing services", () => {
  test.describe.configure({ timeout: 60000 });

  test("1. Todo prendido: camino feliz", async ({ request }) => {
    const viajeId = nuevoId("TODO-OK");

    expect(await publicar(request, viajeId)).toBe(true);
    await expect.poll(() => esDuplicado(request, viajeId), { timeout: 15000 }).toBe(true);
  });

  test("2. Redis apagado: sigue procesando (usa la base)", async ({ request }) => {
    docker("stop redis");
    await esperar(2000);

    const viajeId = nuevoId("SIN-REDIS");
    expect(await publicar(request, viajeId)).toBe(true);

    // sin caché, /pagos igual responde porque estaEnCache() no explota
    await expect.poll(() => esDuplicado(request, viajeId), { timeout: 15000 }).toBe(true);

    docker("start redis");
  });

  test("3. RabbitMQ se cae y vuelve: el servicio se reconecta solo", async ({ request }) => {
    const viajeIdAntes = nuevoId("PRE-CAIDA");
    expect(await publicar(request, viajeIdAntes)).toBe(true);
    await expect.poll(() => esDuplicado(request, viajeIdAntes), { timeout: 15000 }).toBe(true);

    docker("stop rabbitmq");
    await esperar(3000); // el consumer queda sin conexión

    docker("start rabbitmq");
    await esperar(10000); // tiempo para que amqplib reconecte y rearme la topología

    const viajeIdDespues = nuevoId("POST-CAIDA");
    expect(await publicar(request, viajeIdDespues)).toBe(true);
    await expect.poll(() => esDuplicado(request, viajeIdDespues), { timeout: 15000 }).toBe(true);
  });

  test("4. Redis y RabbitMQ caen juntos y vuelven: recupera sin intervención", async ({
    request,
  }) => {
    docker("stop redis rabbitmq");
    await esperar(3000);

    docker("start redis rabbitmq");
    await esperar(10000);

    const viajeId = nuevoId("DOBLE-CAIDA");
    expect(await publicar(request, viajeId)).toBe(true);
    await expect.poll(() => esDuplicado(request, viajeId), { timeout: 15000 }).toBe(true);
  });
});
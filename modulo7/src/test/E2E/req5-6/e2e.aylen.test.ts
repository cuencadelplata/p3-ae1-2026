import { test, expect, type APIRequestContext } from "@playwright/test";
import { execSync } from "node:child_process";

const RABBIT_API = "http://localhost:15672";
const AUTH = "Basic " + Buffer.from("guest:guest").toString("base64");
const HEADERS = { Authorization: AUTH };

const nuevoId = () => `V-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function publicarEventoM6(request: APIRequestContext, viajeId: string) {
  const r = await request.post(`${RABBIT_API}/api/exchanges/%2F/viajes/publish`, {
    headers: HEADERS,
    data: {
      properties: {},
      routing_key: "cancelacion_cliente",
      payload: JSON.stringify({
        viajeId,
        clienteId: `C-${viajeId}`,
        conductorId: `D-${viajeId}`,
        motivo: "cliente solicita cancelación",
        evento: "cancelacion_cliente",
        timestamp: new Date().toISOString(),
      }),
      payload_encoding: "string",
    },
  });
  return (await r.json()).routed === true;
}

async function esDuplicado(request: APIRequestContext, viajeId: string) {
  const r = await request.get(`/pagos/${viajeId}/duplicado`);
  const body = await r.json();
  return body.esDuplicado;
}

test("E2E completo: evento de M6 -> RF-7.5 procesa y guarda reintegro", async ({
  request,
}) => {
  const viajeId = nuevoId();

  // 1. Publica evento de cancelación desde M6
  const publicado = await publicarEventoM6(request, viajeId);
  expect(publicado).toBe(true);

  // 2. Espera a que el consumer procese (max 15 segundos)
  let duplicado = false;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      duplicado = await esDuplicado(request, viajeId);
      if (duplicado) break;
    } catch (e) {
      // sigue intentando
    }
  }

  // 3. Verifica que se procesó
  expect(duplicado).toBe(true);
});
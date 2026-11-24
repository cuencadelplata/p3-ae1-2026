import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";
import encoding from "k6/encoding";

const errores = new Counter("errores_total");
const duracionReintegro = new Trend("duracion_reintegro_ms");
const duracionAutorizacion = new Trend("duracion_autorizacion_ms");

// ─── Configuración: controlá desde la terminal con variables de entorno ───────
//   VUS      = cantidad de usuarios simultáneos (default: 10)
//   DURACION = tiempo de carga sostenida       (default: "1m")
//   BASE_URL = URL del servidor                (default: "http://localhost:17000")
//
// Ejemplo: k6 run -e VUS=50 -e DURACION=3m k6/load-test.js
// ─────────────────────────────────────────────────────────────────────────────
const VUS      = parseInt(__ENV.VUS      || "500");
const DURACION = __ENV.DURACION          || "3m";

export const options = {
  stages: [
    { duration: "1m", target: 50 },
    { duration: "2m", target: 50 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_failed:          ["rate<0.05"],
    http_req_duration:        ["p(95)<3000"],
    duracion_reintegro_ms:    ["p(95)<5000"],
    duracion_autorizacion_ms: ["p(95)<5000"],
  },
};

const BASE_URL      = __ENV.BASE_URL    || "http://localhost:17000";
const RABBIT_API    = __ENV.RABBIT_API  || "http://localhost:17002";
const RABBIT_AUTH   = __ENV.RABBIT_AUTH || "Basic " + encoding.b64encode("guest:guest");
const MP_PUBLIC_KEY = __ENV.MP_PUBLIC_KEY || "TEST-bc8db768-1690-493a-9cfb-408e8646c0d1";
const API_KEY       = __ENV.API_KEY       || "m7-123";
const HEADERS_JSON    = { "Content-Type": "application/json" };
const HEADERS_API_KEY = { "Content-Type": "application/json", "x-api-key": API_KEY };

function uid() { return `k6-${__VU}-${__ITER}-${Date.now()}`; }

function publicarCancelacion(viajeId) {
  const res = http.post(
    `${RABBIT_API}/api/exchanges/%2F/viajes/publish`,
    JSON.stringify({
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
    }),
    { headers: { "Content-Type": "application/json", "Authorization": RABBIT_AUTH } }
  );
  check(res, { "cancelacion publicada en rabbit": (r) => r.status === 200 }) || errores.add(1);
}

function generarTokenMP() {
  const res = http.post(
    `https://api.mercadopago.com/v1/card_tokens?public_key=${MP_PUBLIC_KEY}`,
    JSON.stringify({
      card_number: "4509953566233704", security_code: "123",
      expiration_month: 11, expiration_year: 2030,
      cardholder: { name: "APRO", identification: { type: "DNI", number: "12345678" } },
    }),
    { headers: HEADERS_JSON }
  );
  if (res.status !== 200 && res.status !== 201) return null;
  return res.json().id || null;
}

export default function () {

  // 1. Health check
  const res1 = http.get(`${BASE_URL}/health`);
  check(res1, { "health 200": (r) => r.status === 200 }) || errores.add(1);
  sleep(0.3);

  // 2. Estimación de tarifa
  const res2 = http.post(`${BASE_URL}/tarifa/estimacion`, JSON.stringify({
    origen: { lat: -27.46, lng: -58.98 }, destino: { lat: -27.47, lng: -58.99 },
    distanciaKm: 10, tiempoEstimadoMin: 20, vehicleType: "auto",
  }), { headers: HEADERS_JSON });
  check(res2, { "estimacion 200": (r) => r.status === 200 }) || errores.add(1);
  sleep(0.3);

  // 3. Cargo por cancelación
  const res3 = http.post(`${BASE_URL}/cancelacion/cargo`, JSON.stringify({
    tripId: uid(), requestedBy: "cliente", vehicleType: "auto",
    tripStatus: "asignado", estimatedFare: 1500,
    assignedAt: new Date(Date.now() - 200000).toISOString(),
    cancelledAt: new Date().toISOString(),
  }), { headers: HEADERS_JSON });
  check(res3, { "cargo cancelacion 200": (r) => r.status === 200 }) || errores.add(1);
  sleep(0.3);

  // 4. Registrar método de pago
  const viajeId = uid();
  const idOrden = `orden-${viajeId}`;

  const res4 = http.post(`${BASE_URL}/metodo-pago`, JSON.stringify({
    clienteId: `cliente-${viajeId}`, viajeId, tipo: "tarjeta",
  }), { headers: HEADERS_API_KEY });
  check(res4, { "metodo-pago 201": (r) => r.status === 201 }) || errores.add(1);
  sleep(0.3);

  // 5. Consultar método de pago
  const res5 = http.get(`${BASE_URL}/metodo-pago/${viajeId}`, { headers: HEADERS_API_KEY });
  check(res5, { "get metodo-pago 200": (r) => r.status === 200 }) || errores.add(1);
  sleep(0.3);

  // 6. Generar token MP y autorizar pago
  const tokenMP = generarTokenMP();
  if (tokenMP) {
    const start6 = Date.now();
    const res6 = http.post(`${BASE_URL}/metodo-pago/${viajeId}/autorizar`, JSON.stringify({
      idOrden, total: 100, token: tokenMP,
      paymentMethodId: "visa", email: "test_user_123@testuser.com",
    }), { headers: HEADERS_API_KEY });
    duracionAutorizacion.add(Date.now() - start6);
    check(res6, { "autorizar 200": (r) => r.status === 200 }) || errores.add(1);
  } else {
    errores.add(1);
  }
  sleep(0.3);

  // 7. Verificar pago duplicado
  const res7 = http.get(`${BASE_URL}/pagos/${idOrden}/duplicado`);
  check(res7, { "duplicado 200": (r) => r.status === 200 }) || errores.add(1);
  sleep(0.3);

  // 8. Reintegro HTTP directo
  const start8 = Date.now();
  const res8 = http.post(`${BASE_URL}/reintegro`, JSON.stringify({
    montoCancelacion: 100, viajeId,
  }), { headers: HEADERS_JSON });
  duracionReintegro.add(Date.now() - start8);
  check(res8, { "reintegro 200": (r) => r.status === 200 }) || errores.add(1);
  sleep(0.3);

  // 9. Registrar operación en historial financiero
  const res9 = http.post(`${BASE_URL}/operations`, JSON.stringify({
    type: "payment", amount: 100,
  }), { headers: HEADERS_JSON });
  check(res9, { "historial 201": (r) => r.status === 201 }) || errores.add(1);
  sleep(0.3);

  // 10. Consultar historial financiero
  const res10 = http.get(`${BASE_URL}/operations`);
  check(res10, { "historial get 200": (r) => r.status === 200 }) || errores.add(1);
  sleep(0.3);

  // 11. Publicar evento de cancelación vía RabbitMQ (dispara RF-7.5 reintegro)
  const viajeIdCancelado = uid();
  publicarCancelacion(viajeIdCancelado);
  sleep(25); // espera a que el consumer procese

  // 12. Verificar que el reintegro fue procesado (duplicado = true)
  const start12 = Date.now();
  const res12 = http.get(`${BASE_URL}/pagos/${viajeIdCancelado}/duplicado`);
  duracionReintegro.add(Date.now() - start12);
  check(res12, {
    "reintegro procesado (duplicado=true)": (r) => {
      try { return r.json().esDuplicado === true; } catch { return false; }
    },
  }) || errores.add(1);

  sleep(1);
}
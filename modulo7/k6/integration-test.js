/**
 * TEST DE FLUJO COMPLETO DE INTEGRACIÓN - M7 Tarifas, Pagos y Liquidaciones
 *
 * FLUJO REAL
 *   1. M7: estimación de tarifa (RF-7.1)
 *   2. M6: crear viaje real → M7: registrar método de pago (RF-7.2)
 *   3. M7: autorización MercadoPago sandbox (RF-7.3)
 *   4. M7: cargo de cancelación — código real de Lautaro (RF-7.4)
 *   5. M6: cancelar viaje → publica cancelacion_cliente en RabbitMQ
 *      → M7 consumer recibe → llama /api/m7/cargo-cancelacion (mismo M7)
 *      → calcula reintegro (Aylen) → guarda en DB → marca Redis (RF-7.5)
 *   6. M7: verificar idempotencia (RF-7.6)
 *   7. M7: historial financiero (RF-7.7)

 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Counter, Trend } from "k6/metrics";
import encoding from "k6/encoding";

// ─── Métricas custom ─────────────────────────────────────────────────────────
const pasosFallidos = new Counter("pasos_fallidos");
const duracionFlujoCompleto = new Trend("duracion_flujo_completo_ms");

// ─── Config ──────────────────────────────────────────────────────────────────
const BASE_URL      = __ENV.BASE_URL      || "http://localhost:17000";
const M6_URL        = __ENV.M6_URL        || "http://localhost:15001"; // m6-cancelacion
const M6_VIAJES_URL = __ENV.M6_VIAJES_URL || "http://localhost:15000"; // m6-viajes
const RABBIT_API    = __ENV.RABBIT_API    || "http://localhost:15672"; // RabbitMQ management (M9, default m9:m9-local)
const RABBIT_AUTH   = __ENV.RABBIT_AUTH   || "Basic " + encoding.b64encode("m9:m9-local");
const API_KEY       = __ENV.API_KEY       || "m7-123";
const MP_PUBLIC_KEY = __ENV.MP_PUBLIC_KEY || "TEST-bc8db768-1690-493a-9cfb-408e8646c0d1";

const H_JSON    = { "Content-Type": "application/json" };
const H_API_KEY = { "Content-Type": "application/json", "x-api-key": API_KEY };

// ─── Opciones: 1 VU, 1 iteración (flujo de validación, no de carga) ──────────
export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    pasos_fallidos: ["count==0"],
    duracion_flujo_completo_ms: ["p(100)<120000"], // máx 2 minutos
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function uid() {
  return `integ-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function verificar(res, nombre, condiciones) {
  const paso = check(res, condiciones);
  if (!paso) {
    pasosFallidos.add(1);
    console.error(`❌ ${nombre} falló — status=${res.status} body=${(res.body || "").slice(0, 300)}`);
  }
  return paso;
}

function ok2xx(res, nombre) {
  return verificar(res, nombre, {
    [`${nombre} → 2xx`]: (r) => r.status >= 200 && r.status < 300,
  });
}

function generarTokenMP() {
  const res = http.post(
    `https://api.mercadopago.com/v1/card_tokens?public_key=${MP_PUBLIC_KEY}`,
    JSON.stringify({
      card_number: "4509953566233704",
      security_code: "123",
      expiration_month: 11,
      expiration_year: 2030,
      cardholder: {
        name: "APRO",
        identification: { type: "DNI", number: "12345678" },
      },
    }),
    { headers: H_JSON }
  );
  if (res.status !== 200 && res.status !== 201) {
    console.warn(`⚠️  MercadoPago token generó status ${res.status} — continuando sin token real`);
    return null;
  }
  return res.json()?.id || null;
}

// ─── FLUJO PRINCIPAL ──────────────────────────────────────────────────────────
export default function () {
  const inicioFlujo = Date.now();
  const clienteId   = `cli-${uid()}`;
  const conductorId = `cond-${uid()}`;

  console.log(`\n${"═".repeat(65)}`);
  console.log(`🚀 INICIO FLUJO INTEGRACIÓN REAL`);
  console.log(`   M7:  ${BASE_URL}`);
  console.log(`   M6:  ${M6_URL} / ${M6_VIAJES_URL}`);
  console.log(`   RMQ: ${RABBIT_API}`);
  console.log(`${"═".repeat(65)}\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // PASO 0: Health checks de los servicios reales
  // ───────────────────────────────────────────────────────────────────────────
  group("PASO 0 — Health checks", () => {
    const resM7 = http.get(`${BASE_URL}/health`);
    ok2xx(resM7, "M7 health");

    const resM6 = http.get(`${M6_VIAJES_URL}/health`);
    ok2xx(resM6, "M6 viajes health");

    console.log(`✅ Servicios operativos`);
    sleep(0.5);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // RF-7.1: Estimación de tarifa
  // M7 calcula tarifa estimada según distancia, tiempo y tipo de vehículo
  // ───────────────────────────────────────────────────────────────────────────
  let tarifaEstimada = 5000;
  group("RF-7.1 — Estimación de tarifa", () => {
    console.log("\n📊 RF-7.1: Estimando tarifa...");
    const res = http.post(
      `${BASE_URL}/tarifa/estimacion`,
      JSON.stringify({
        origen:  { lat: -27.46, lng: -58.98 },
        destino: { lat: -27.47, lng: -58.99 },
        distanciaKm: 10,
        tiempoEstimadoMin: 20,
        vehicleType: "auto",
      }),
      { headers: H_JSON }
    );
    if (ok2xx(res, "RF-7.1 estimacion")) {
      const data = res.json();
      tarifaEstimada = data.tarifa || data.estimacion || data.precio || data.total || 5000;
      console.log(`   ✅ Tarifa estimada: $${tarifaEstimada} ARS`);
    }
    sleep(0.3);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Crear viaje real en M6
  // Para el flujo completo, el viaje tiene que existir en M6 para poder cancelarlo
  // M6 viajes: POST /api/viajes — crea un viaje en estado SOLICITADO
  // ───────────────────────────────────────────────────────────────────────────
  let viajeId = null;
  group("PREVIO — Crear viaje real en M6", () => {
    console.log("\n🗺️  Creando viaje real en M6...");
    const res = http.post(
      `${M6_VIAJES_URL}/api/viajes`,
      JSON.stringify({
        clienteId,
        origen:  "Av. Independencia 1200, Corrientes",
        destino: "Av. 3 de Abril 500, Corrientes",
        vehicleType: "auto",
      }),
      { headers: H_JSON }
    );
    if (ok2xx(res, "M6 crear viaje")) {
      const data = res.json();
      viajeId = String(data.id || data.viajeId || data.viaje?.id || "");
      console.log(`   ✅ Viaje creado en M6: id=${viajeId}`);
    } else {
      // Si M6 no está disponible o falla, generamos un id sintético para los tests de M7 que no dependen de M6
      viajeId = uid();
      console.warn(`   ⚠️  No se pudo crear viaje en M6 — usando id sintético: ${viajeId}`);
    }
    sleep(0.5);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Asignar conductor para poder cancelar con cargo (estado CONDUCTOR_EN_CAMINO)
  // ───────────────────────────────────────────────────────────────────────────
  group("PREVIO — Asignar conductor en M6", () => {
    if (!viajeId) return;
    console.log("\n🚗 Asignando conductor en M6...");

    // RF-6.2: asignar conductor
    const resAsignar = http.post(
      `${M6_VIAJES_URL}/api/viajes/${encodeURIComponent(viajeId)}/asignar`,
      JSON.stringify({ conductorId }),
      { headers: H_JSON }
    );
    if (resAsignar.status >= 200 && resAsignar.status < 300) {
      console.log(`   ✅ Conductor asignado`);
    } else {
      console.warn(`   ⚠️  No se pudo asignar conductor (${resAsignar.status}) — viaje queda en SOLICITADO (cargo=0)`);
    }
    sleep(0.3);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // RF-7.2: Registrar y consultar método de pago
  // El cliente asocia su método antes de comenzar el viaje
  // ───────────────────────────────────────────────────────────────────────────
  group("RF-7.2 — Registrar método de pago", () => {
    console.log("\n💳 RF-7.2: Registrando método de pago...");
    const res = http.post(
      `${BASE_URL}/metodo-pago`,
      JSON.stringify({
        clienteId,
        viajeId,
        tipo: "tarjeta",
      }),
      { headers: H_API_KEY }
    );
    ok2xx(res, "RF-7.2 POST metodo-pago");
    if (res.status >= 200 && res.status < 300) {
      console.log(`   ✅ Método registrado`);
    }
    sleep(0.3);

    // Consultar el método registrado
    const resGet = http.get(`${BASE_URL}/metodo-pago/${viajeId}`, { headers: H_API_KEY });
    ok2xx(resGet, "RF-7.2 GET metodo-pago");
    sleep(0.3);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // RF-7.3: Autorización de pago con MercadoPago sandbox
  // ───────────────────────────────────────────────────────────────────────────
  const idOrden = `orden-${viajeId}`;
  group("RF-7.3 — Autorización MercadoPago", () => {
    console.log("\n🔐 RF-7.3: Autorizando pago con MercadoPago...");
    const tokenMP = generarTokenMP();
    if (!tokenMP) {
      pasosFallidos.add(1);
      console.error("   ❌ No se pudo generar token MP — falla RF-7.3");
      return;
    }
    const res = http.post(
      `${BASE_URL}/metodo-pago/${viajeId}/autorizar`,
      JSON.stringify({
        idOrden,
        total: tarifaEstimada,
        token: tokenMP,
        paymentMethodId: "visa",
        email: "test_user_123@testuser.com",
      }),
      { headers: H_API_KEY }
    );
    if (ok2xx(res, "RF-7.3 autorizar pago")) {
      const data = res.json();
      console.log(`   ✅ Pago autorizado: status=${data.status || "ok"}`);
    }
    sleep(0.3);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // RF-7.6: Idempotencia — el pago ya está registrado, no debe duplicarse
  // ───────────────────────────────────────────────────────────────────────────
  group("RF-7.6 — Idempotencia de pago ya autorizado", () => {
    console.log("\n🔁 RF-7.6: Verificando idempotencia del pago...");
    const res = http.get(`${BASE_URL}/pagos/${idOrden}/duplicado`);
    if (ok2xx(res, "RF-7.6 duplicado")) {
      const data = res.json();
      verificar(res, "RF-7.6 pago registrado como duplicado", {
        "esDuplicado=true": (r) => { try { return r.json().esDuplicado === true; } catch { return false; } },
      });
      console.log(`   ✅ esDuplicado=${data?.esDuplicado}`);
    }
    sleep(0.3);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // RF-7.4: Cargo de cancelación (endpoint real de Lautaro dentro de M7)
  // Verifica cuánto corresponde cobrarle al cliente si cancela ahora
  // ───────────────────────────────────────────────────────────────────────────
  group("RF-7.4 — Cargo de cancelación (Lautaro/M7)", () => {
    console.log("\n💸 RF-7.4: Calculando cargo de cancelación...");
    const res = http.post(
      `${BASE_URL}/cancelacion/cargo`,
      JSON.stringify({
        tripId: viajeId,
        requestedBy: "cliente",
        vehicleType: "auto",
        tripStatus: "conductor_en_camino",
        estimatedFare: tarifaEstimada,
        assignedAt: new Date(Date.now() - 300_000).toISOString(), // 5 min atrás
        cancelledAt: new Date().toISOString(),
      }),
      { headers: H_JSON }
    );
    if (ok2xx(res, "RF-7.4 cargo-cancelacion")) {
      const data = res.json();
      console.log(`   ✅ Cargo calculado: $${data.charge} ARS (regla: ${data.breakdown?.ruleApplied})`);
    }
    sleep(0.3);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // RF-7.5 (vía M6 real): CANCELACIÓN REAL → EVENTO RABBITMQ → REINTEGRO
  //
  // Flujo:
  //   POST /api/viajes/:id/cancelacion-cliente (M6)
  //     → M6 cambia estado del viaje a CANCELADO
  //     → M6 publica "cancelacion_cliente" en exchange "viajes" de RabbitMQ
  //     → M7 consumer lee de la cola "m7.reintegro.viaje-cancelado"
  //     → M7 llama POST /api/m7/cargo-cancelacion (Lautaro, mismo contenedor)
  //     → M7 calcula montoReintegro (Aylen: calculoReintegro)
  //     → M7 inserta en tabla reintegros
  //     → M7 marca en Redis como procesado
  // ───────────────────────────────────────────────────────────────────────────
  group("RF-7.5 — Cancelación real via M6 → Reintegro via RabbitMQ", () => {
    console.log("\n🐰 RF-7.5: Cancelando viaje en M6 (flujo real)...");
    console.log(`   viajeId: ${viajeId}`);

    const res = http.post(
      `${M6_URL}/api/viajes/${encodeURIComponent(viajeId)}/cancelacion-cliente`,
      JSON.stringify({ motivo: "Prueba de integración completa AE4" }),
      { headers: H_JSON }
    );

    if (ok2xx(res, "RF-7.5 cancelacion via M6")) {
      const data = res.json();
      console.log(`   ✅ Viaje cancelado en M6: estado=${data.viaje?.estado || "CANCELADO"}`);
      console.log(`   ⏳ Esperando que el consumer de M7 procese el reintegro (~25s)...`);
    } else {
      console.warn(`   ⚠️  Cancelación via M6 falló (${res.status}) — probando publicación directa en RabbitMQ`);

      // Fallback: publicar directamente en RabbitMQ si M6 no está disponible
      const evento = {
        viajeId,
        clienteId,
        conductorId,
        motivo: "Prueba de integración — fallback directo",
        evento: "cancelacion_cliente",
        timestamp: new Date().toISOString(),
      };
      const resFallback = http.post(
        `${RABBIT_API}/api/exchanges/%2F/viajes/publish`,
        JSON.stringify({
          properties: {},
          routing_key: "cancelacion_cliente",
          payload: JSON.stringify(evento),
          payload_encoding: "string",
        }),
        { headers: { "Content-Type": "application/json", "Authorization": RABBIT_AUTH } }
      );
      if (resFallback.status >= 200 && resFallback.status < 300) {
        console.log(`   ✅ Evento publicado directamente en RabbitMQ (fallback)`);
      } else {
        pasosFallidos.add(1);
        console.error(`   ❌ Fallback RabbitMQ también falló: ${resFallback.status} ${resFallback.body}`);
      }
    }

    // Dar tiempo al consumer para procesar
    sleep(25);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // VERIFICAR RF-7.5 + RF-7.6: El consumer procesó y marcó como duplicado
  // GET /pagos/:viajeId/duplicado → esDuplicado=true confirma que el consumer
  // ejecutó todo el flujo: obtenerCargo → calculoReintegro → insertarReintegro → marcarEnCache
  // ───────────────────────────────────────────────────────────────────────────
  group("VERIFICAR RF-7.5+7.6 — Reintegro procesado (esDuplicado=true)", () => {
    console.log("\n🔍 Verificando que M7 procesó el reintegro del viaje cancelado...");
    const res = http.get(`${BASE_URL}/pagos/${viajeId}/duplicado`);
    if (ok2xx(res, "verificar reintegro procesado")) {
      const data = res.json();
      const paso = verificar(res, "RF-7.5+7.6 reintegro procesado via RabbitMQ", {
        "esDuplicado=true (reintegro procesado por consumer)": (r) => {
          try { return r.json().esDuplicado === true; } catch { return false; }
        },
      });
      if (paso) {
        console.log(`   ✅ REINTEGRO PROCESADO CORRECTAMENTE`);
        console.log(`   ✅ Integración M6→RabbitMQ→M7→cargo-cancelacion(Lautaro)→reintegro(Aylen) FUNCIONA`);
      } else {
        console.error(`   ❌ esDuplicado=${data?.esDuplicado} — el consumer no procesó el reintegro`);
        console.error(`   💡 Verificá que CARGO_CANCELACION_URL=http://m7-api:3000 en compose.integracion.yml`);
        console.error(`   💡 Verificá que el exchange 'viajes' exista en RabbitMQ`);
      }
    }
    sleep(0.3);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // RF-7.5 (vía HTTP directo): verificar también la ruta directa de reintegro
  // ───────────────────────────────────────────────────────────────────────────
  group("RF-7.5 — Reintegro vía HTTP directo (ruta alternativa)", () => {
    console.log("\n💰 RF-7.5: Verificando reintegro vía HTTP directo...");
    const viajeDirecto = uid();
    const res = http.post(
      `${BASE_URL}/reintegro`,
      JSON.stringify({
        montoCancelacion: 1000,
        viajeId: viajeDirecto,
      }),
      { headers: H_JSON }
    );
    if (ok2xx(res, "RF-7.5 reintegro HTTP directo")) {
      const data = res.json();
      console.log(`   ✅ montoReintegro=$${data.montoReintegro}`);
    }
    sleep(0.3);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // RF-7.7: Historial financiero
  // ───────────────────────────────────────────────────────────────────────────
  group("RF-7.7 — Historial financiero", () => {
    console.log("\n📋 RF-7.7: Registrando y consultando historial...");
    const resPost = http.post(
      `${BASE_URL}/operations`,
      JSON.stringify({ type: "payment", amount: tarifaEstimada }),
      { headers: H_JSON }
    );
    ok2xx(resPost, "RF-7.7 POST operations");

    const resGet = http.get(`${BASE_URL}/operations`);
    if (ok2xx(resGet, "RF-7.7 GET operations")) {
      const data = resGet.json();
      const cantidad = Array.isArray(data) ? data.length : (data?.operations?.length ?? "?");
      console.log(`   ✅ Historial con ${cantidad} operaciones`);
    }
    sleep(0.3);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // RESUMEN
  // ───────────────────────────────────────────────────────────────────────────
  const duracionTotal = Date.now() - inicioFlujo;
  duracionFlujoCompleto.add(duracionTotal);

  console.log(`\n${"═".repeat(65)}`);
  console.log(`🏁 FLUJO COMPLETADO en ${(duracionTotal / 1000).toFixed(1)}s`);
  console.log(`   viajeId: ${viajeId}`);
  console.log(`   clienteId: ${clienteId}`);
  console.log(`${"═".repeat(65)}`);
  console.log(`\nRequerimientos verificados:`);
  console.log(`  RF-7.1 Estimación de tarifa       — POST /tarifa/estimacion`);
  console.log(`  RF-7.2 Método de pago             — POST+GET /metodo-pago`);
  console.log(`  RF-7.3 Autorización MP            — POST /metodo-pago/:id/autorizar`);
  console.log(`  RF-7.4 Cargo cancelación (Lautaro)— POST /cancelacion/cargo`);
  console.log(`  RF-7.5 Reintegro (M6+Rabbit+Aylen)— cancelacion M6 → consumer M7`);
  console.log(`  RF-7.6 Idempotencia               — GET /pagos/:id/duplicado`);
  console.log(`  RF-7.7 Historial                  — POST+GET /operations`);
  console.log(`${"═".repeat(65)}\n`);
}

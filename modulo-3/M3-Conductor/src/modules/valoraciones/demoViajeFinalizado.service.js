/**
 * Orquesta el ciclo real de M6 (sin mocks) para habilitar una valoración:
 * crear → asignar → arribo → iniciar → finalizar.
 * M6 publica viaje.finalizado en RabbitMQ; el consumer de valoraciones lo consume.
 */

const M6_BASE =
  process.env.M6_VIAJES_URL ||
  process.env.VIAJES_URL ||
  "http://viajes:3000";

const M1_BASE =
  process.env.M1_URL ||
  process.env.M1_AUTH_URL ||
  "";

const DEMO_CLIENTE_EMAIL =
  process.env.M3_DEMO_CLIENTE_EMAIL || "demo-pasajero-m3@movilidad.local";
const DEMO_CLIENTE_PASSWORD =
  process.env.M3_DEMO_CLIENTE_PASSWORD || "DemoPasajero123!";
const DEMO_CLIENTE_DNI = process.env.M3_DEMO_CLIENTE_DNI || "40999888";
const DEMO_CLIENTE_TEL = process.env.M3_DEMO_CLIENTE_TEL || "1140999888";

function parsearEnteroPositivo(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function obtenerUsuarioDesdeTokenM1(authorization) {
  if (!M1_BASE || !authorization) return null;
  try {
    const res = await fetch(`${M1_BASE.replace(/\/+$/, "")}/auth/me`, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const usuario = data.usuario || data.user || data;
    const id = parsearEnteroPositivo(usuario?.id ?? usuario?.userId);
    return id ? { id, rol: usuario?.rol || usuario?.role } : null;
  } catch {
    return null;
  }
}

async function obtenerSesionClienteDemoM1() {
  if (!M1_BASE) return null;
  const base = M1_BASE.replace(/\/+$/, "");

  const intentarLogin = async () => {
    const res = await fetch(`${base}/auth/iniciar-sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: DEMO_CLIENTE_EMAIL,
        password: DEMO_CLIENTE_PASSWORD
      }),
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const token = data.token || data.accessToken;
    const userId = parsearEnteroPositivo(data.usuario?.id ?? data.user?.id);
    if (!token || !userId) return null;
    return { authorization: `Bearer ${token}`, userId };
  };

  try {
    const sesion = await intentarLogin();
    if (sesion) return sesion;

    await fetch(`${base}/auth/registrar-usuario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: "Pasajero",
        apellido: "Demo M3",
        email: DEMO_CLIENTE_EMAIL,
        password: DEMO_CLIENTE_PASSWORD,
        rol: "CLIENTE",
        dni: DEMO_CLIENTE_DNI,
        telefono: DEMO_CLIENTE_TEL
      }),
      signal: AbortSignal.timeout(4000)
    });

    return await intentarLogin();
  } catch {
    return null;
  }
}

async function m6(method, path, body, authorization) {
  const url = `${M6_BASE.replace(/\/+$/, "")}${path}`;
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (authorization) headers.Authorization = authorization;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    const err = new Error(
      `No se pudo conectar con Viajes (M6) en ${url}: ${error.message}`
    );
    err.status = 503;
    err.paso = path;
    throw err;
  }

  const texto = await response.text();
  let data = null;
  try {
    data = texto ? JSON.parse(texto) : null;
  } catch {
    data = { raw: texto };
  }

  if (!response.ok) {
    const detalle =
      (data && (data.error?.code || data.error?.message || data.error)) ||
      texto ||
      response.statusText;
    const err = new Error(
      `M6 falló en ${method} ${path} (${response.status}): ${
        typeof detalle === "string" ? detalle : JSON.stringify(detalle)
      }`
    );
    err.status = response.status >= 500 ? 503 : 502;
    err.paso = path;
    err.upstreamStatus = response.status;
    err.upstream = data;
    throw err;
  }

  return data;
}

async function ejecutarDemoViajeFinalizado(input = {}, opciones = {}) {
  const authorization = opciones.authorization || null;
  const origen = input.origen || "Calle A";
  const destino = input.destino || "Calle B";

  const [conductorM1, sesionClienteM1] = await Promise.all([
    obtenerUsuarioDesdeTokenM1(authorization),
    obtenerSesionClienteDemoM1()
  ]);

  const driverUserId =
    conductorM1?.id || parsearEnteroPositivo(input.conductorId);
  const clientUserId =
    sesionClienteM1?.userId || parsearEnteroPositivo(input.clienteId);

  const conductorId = String(
    input.conductorId || driverUserId || "conductor-001"
  ).trim();
  const clienteId = String(
    sesionClienteM1 ? sesionClienteM1.userId : input.clienteId || "cliente-001"
  ).trim();

  const clienteAuth = sesionClienteM1?.authorization || authorization;

  const pasos = [];

  const bodyCrear = {
    clienteId,
    origen,
    destino
  };
  if (clientUserId) bodyCrear.clientUserId = clientUserId;

  const creado = await m6("POST", "/api/viajes", bodyCrear, clienteAuth);
  const viajeId = creado.id || creado.viaje?.id;
  if (!viajeId) {
    const err = new Error("M6 no devolvió id de viaje al crear");
    err.status = 502;
    err.paso = "crear";
    throw err;
  }
  pasos.push({ paso: "crear", viajeId, estado: creado.estado });

  const bodyAsignar = { conductorId };
  if (driverUserId) bodyAsignar.driverUserId = driverUserId;

  const asignado = await m6(
    "POST",
    `/api/viajes/${encodeURIComponent(viajeId)}/asignar`,
    bodyAsignar,
    authorization
  );
  pasos.push({
    paso: "asignar",
    estado: asignado.viaje?.estado || asignado.estado
  });

  const arribo = await m6(
    "PUT",
    `/api/viajes/${encodeURIComponent(viajeId)}/arribo`,
    undefined,
    clienteAuth
  );
  const token = arribo.qr?.token || arribo.viaje?.codigoVerificacion;
  if (!token) {
    const err = new Error(
      "M6 no devolvió token QR en arribo (¿M8 disponible?). Sin QR no se puede iniciar el viaje."
    );
    err.status = 502;
    err.paso = "arribo";
    err.upstream = arribo;
    throw err;
  }
  pasos.push({ paso: "arribo", estado: arribo.viaje?.estado || "ARRIBADO" });

  const iniciado = await m6(
    "POST",
    `/api/viajes/${encodeURIComponent(viajeId)}/iniciar`,
    {
      codigoVerificacion: token
    },
    authorization
  );
  pasos.push({
    paso: "iniciar",
    estado: iniciado.viaje?.estado || iniciado.estado
  });

  try {
    const destinoConfirmado = await m6(
      "POST",
      `/api/viajes/${encodeURIComponent(viajeId)}/destino`,
      {},
      authorization
    );
    pasos.push({
      paso: "destino",
      confirmado: true,
      destinoConfirmadoAt: destinoConfirmado?.destinoConfirmadoAt || null
    });
  } catch (errDestino) {
    if (errDestino.upstreamStatus !== 404) {
      throw errDestino;
    }
  }

  const horaFin = new Date().toISOString();
  const finalizado = await m6(
    "POST",
    `/api/viajes/${encodeURIComponent(viajeId)}/finalizacion`,
    {
      origen: { latitude: -31.4167, longitude: -64.1833, address: String(origen) },
      destino: { latitude: -31.42, longitude: -64.18, address: String(destino) },
      tipoVehiculo: "auto",
      horaFin,
      metodoPago: "efectivo",
      gestionarPago: true
    },
    clienteAuth
  );
  pasos.push({
    paso: "finalizar",
    estado: finalizado.viaje?.estado || finalizado.estado
  });

  return {
    ok: true,
    viajeId,
    clienteId,
    conductorId,
    evaluadorId: conductorId,
    evaluadoId: clienteId,
    pasos,
    mensaje:
      "Viaje finalizado en M6. Si RabbitMQ está conectado, M3 habilitará la valoración pendiente."
  };
}

module.exports = {
  ejecutarDemoViajeFinalizado,
  M6_BASE
};

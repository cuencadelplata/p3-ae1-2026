/**
 * Orquesta el ciclo real de M6 (sin mocks) para habilitar una valoración:
 * crear → asignar → arribo → iniciar → finalizar.
 * M6 publica viaje.finalizado en RabbitMQ; el consumer de valoraciones lo consume.
 */

const M6_BASE =
  process.env.M6_VIAJES_URL ||
  process.env.VIAJES_URL ||
  "http://viajes:3000";

async function m6(method, path, body) {
  const url = `${M6_BASE.replace(/\/+$/, "")}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
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

async function ejecutarDemoViajeFinalizado(input = {}) {
  const clienteId = String(input.clienteId || "cliente-001").trim();
  const conductorId = String(input.conductorId || "conductor-001").trim();
  const origen = input.origen || "Calle A";
  const destino = input.destino || "Calle B";

  const pasos = [];

  const creado = await m6("POST", "/api/viajes", {
    clienteId,
    origen,
    destino
  });
  const viajeId = creado.id || creado.viaje?.id;
  if (!viajeId) {
    const err = new Error("M6 no devolvió id de viaje al crear");
    err.status = 502;
    err.paso = "crear";
    throw err;
  }
  pasos.push({ paso: "crear", viajeId, estado: creado.estado });

  const asignado = await m6("POST", `/api/viajes/${encodeURIComponent(viajeId)}/asignar`, {
    conductorId
  });
  pasos.push({
    paso: "asignar",
    estado: asignado.viaje?.estado || asignado.estado
  });

  const arribo = await m6("PUT", `/api/viajes/${encodeURIComponent(viajeId)}/arribo`);
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

  const iniciado = await m6("POST", `/api/viajes/${encodeURIComponent(viajeId)}/iniciar`, {
    codigoVerificacion: token
  });
  pasos.push({
    paso: "iniciar",
    estado: iniciado.viaje?.estado || iniciado.estado
  });

  const horaFin = new Date().toISOString();
  const finalizado = await m6(
    "POST",
    `/api/viajes/${encodeURIComponent(viajeId)}/finalizacion`,
    {
      origen: { latitude: -31.4167, longitude: -64.1833, address: String(origen) },
      destino: { latitude: -31.42, longitude: -64.18, address: String(destino) },
      tipoVehiculo: "auto",
      horaFin,
      metodoPago: "efectivo"
    }
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

/**
 * Lee en m3-vehiculos el vehículo y su documentación (licencia, cédula y seguro)
 * para que el operador de M1 pueda revisar el alta antes de habilitar.
 */

const BASE = (process.env.M3_VEHICULOS_URL || "http://m3-vehiculos:8083").replace(/\/$/, "");
const TIMEOUT_MS = parseInt(process.env.M3_VEHICULOS_TIMEOUT_MS || "3000", 10);
const TIPOS_DOCUMENTACION = new Set(["LICENCIA_CONDUCIR", "CEDULA_VEHICULO", "SEGURO_VEHICULO"]);

function marcaDeTiempo(vehiculo) {
  const valor = vehiculo && vehiculo.createdAt;
  const tiempo = valor instanceof Date ? valor.getTime() : Date.parse(valor || "");
  return Number.isFinite(tiempo) ? tiempo : 0;
}

function elegirVehiculo(vehiculos) {
  const lista = Array.isArray(vehiculos) ? vehiculos.filter(Boolean) : [];
  const activo = lista.find((vehiculo) => vehiculo.activo);
  if (activo) return activo;
  return [...lista].sort((a, b) => marcaDeTiempo(b) - marcaDeTiempo(a))[0] || null;
}

function resumirVehiculo(vehiculo) {
  if (!vehiculo) return null;
  return {
    id: vehiculo.id,
    patente: vehiculo.patente,
    marca: vehiculo.marca || null,
    modelo: vehiculo.modelo || null,
    anio: vehiculo.anio,
    tipoServicio: vehiculo.tipoServicio
  };
}

function resumirDocumento(documento) {
  const vencimiento = documento.fechaVencimiento instanceof Date
    ? documento.fechaVencimiento.toISOString()
    : String(documento.fechaVencimiento || "");
  return {
    id: documento.id,
    tipoDocumento: documento.tipoDocumento,
    cara: documento.cara || null,
    numeroDocumento: documento.numeroDocumento,
    fechaVencimiento: vencimiento,
    estado: documento.estado,
    archivoUrl: documento.archivoUrl
  };
}

function seleccionarDocumentacionVehiculo(vehiculos, documentos) {
  const vehiculo = elegirVehiculo(vehiculos);
  const documentacion = (Array.isArray(documentos) ? documentos : [])
    .filter((documento) => documento && TIPOS_DOCUMENTACION.has(documento.tipoDocumento))
    .filter((documento) => !vehiculo || !documento.vehicleId || documento.vehicleId === vehiculo.id)
    .map(resumirDocumento);
  return { vehiculo: resumirVehiculo(vehiculo), documentacion };
}

async function pedir(path) {
  let respuesta;
  try {
    respuesta = await fetch(`${BASE}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    throw new Error(`m3-vehiculos no disponible en ${BASE}: ${error.message}`);
  }
  if (!respuesta.ok) {
    throw new Error(`m3-vehiculos respondió ${respuesta.status} en ${path}`);
  }
  return respuesta.json();
}

async function obtenerDocumentacionVehiculo(driverId) {
  const [vehiculos, documentos] = await Promise.all([
    pedir(`/api/v1/drivers/${encodeURIComponent(driverId)}/vehicles`),
    pedir(`/api/v1/drivers/${encodeURIComponent(driverId)}/documents`)
  ]);
  return seleccionarDocumentacionVehiculo(vehiculos, documentos);
}

module.exports = {
  BASE,
  seleccionarDocumentacionVehiculo,
  obtenerDocumentacionVehiculo
};

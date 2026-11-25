/**
 * Cliente HTTP contra M1 (Identidad y Acceso) REAL. Sin mocks.
 * Contrato: src/api/autenticacion/m1-Auth-openapi.yaml
 *   GET /auth/validar-identidad-y-rol  (Bearer JWT) -> { valid, userId, role }
 */

const M1_URL = (process.env.M1_URL || "http://m1-identidad-acceso:3001").replace(/\/$/, "");
const M1_TIMEOUT_MS = parseInt(process.env.M1_TIMEOUT_MS || "3000", 10);

class M1Error extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Valida el JWT contra M1 y devuelve la identidad.
 * @returns {Promise<{ userId: string, role: string }>}
 * @throws {M1Error} status 401 si M1 rechaza el token, 503 si M1 no responde
 */
async function validarIdentidad(token) {
  let res;
  try {
    res = await fetch(`${M1_URL}/auth/validar-identidad-y-rol`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(M1_TIMEOUT_MS)
    });
  } catch (err) {
    throw new M1Error(`M1 no disponible en ${M1_URL}: ${err.message}`, 503);
  }

  const data = await res.json().catch(() => null);

  if (res.status === 401 || res.status === 403 || (res.ok && data?.valid !== true)) {
    throw new M1Error("Token inválido o expirado según M1", 401);
  }
  if (!res.ok) {
    throw new M1Error(`M1 respondió ${res.status}`, 503);
  }

  return { userId: String(data.userId), role: data.role };
}

/**
 * Guarda en M1 el vehículo y la documentación que el operador va a revisar.
 * @param {string} usuarioId
 * @param {{ vehiculo: object, documentacion: object[] }} alta
 */
async function guardarAltaVehiculo(usuarioId, alta) {
  const clave = process.env.M1_INTERNAL_API_KEY?.trim();
  if (!clave) {
    throw new M1Error("M1_INTERNAL_API_KEY no está configurada", 503);
  }

  let res;
  try {
    res = await fetch(`${M1_URL}/auth/usuarios/${encodeURIComponent(usuarioId)}/alta-vehiculo`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Internal-Api-Key": clave
      },
      body: JSON.stringify({
        vehiculo: alta.vehiculo,
        documentacion: alta.documentacion
      }),
      signal: AbortSignal.timeout(15000)
    });
  } catch (err) {
    throw new M1Error(`M1 no disponible en ${M1_URL}: ${err.message}`, 503);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new M1Error(data?.error || `M1 respondió ${res.status}`, res.status >= 500 ? 503 : res.status);
  }
  return data;
}

module.exports = { M1_URL, M1Error, validarIdentidad, guardarAltaVehiculo };

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

module.exports = { M1_URL, M1Error, validarIdentidad };

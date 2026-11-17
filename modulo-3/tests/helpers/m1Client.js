/**
 * Cliente HTTP contra M1 real (matsir/m1-identidad-acceso).
 * Sin mocks: registra, inicia sesión y valida identidad/rol.
 */

const M1_URL = (process.env.M1_URL || 'http://127.0.0.1:13001').replace(/\/$/, '');

async function m1Request(path, { method = 'GET', body, token } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${M1_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return { status: res.status, ok: res.ok, data };
}

async function ensureM1Healthy() {
  const health = await m1Request('/health');
  if (!health.ok) {
    throw new Error(
      `M1 no responde en ${M1_URL}/health (status ${health.status}). ` +
        'Levantá: docker compose up -d m1-identidad-acceso'
    );
  }
  return health.data;
}

function uniqueEmail(prefix) {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@m3-e2e.test`;
}

function uniqueDni() {
  return String(20000000 + Math.floor(Math.random() * 79999999));
}

/**
 * Registra un usuario real en M1.
 * @param {'CONDUCTOR'|'CLIENTE'|'OPERADOR'} rol
 */
async function registrarUsuarioM1({
  rol = 'CONDUCTOR',
  nombre = 'E2E',
  apellido = 'Conductor',
  telefono = '+541112345678',
  password = 'PasswordE2E123!',
  email,
  dni
} = {}) {
  const payload = {
    nombre,
    apellido,
    dni: dni || uniqueDni(),
    telefono,
    email: email || uniqueEmail(rol.toLowerCase()),
    password,
    rol
  };

  const res = await m1Request('/auth/registrar-usuario', {
    method: 'POST',
    body: payload
  });

  if (res.status !== 201 && res.status !== 200) {
    throw new Error(
      `M1 registrar-usuario falló (${res.status}): ${JSON.stringify(res.data)}`
    );
  }

  return { usuario: res.data, password: payload.password, email: payload.email };
}

async function iniciarSesionM1(email, password) {
  const res = await m1Request('/auth/iniciar-sesion', {
    method: 'POST',
    body: { email, password }
  });

  if (res.status !== 200 || !res.data?.token) {
    throw new Error(
      `M1 iniciar-sesion falló (${res.status}): ${JSON.stringify(res.data)}`
    );
  }

  return res.data;
}

async function validarIdentidadM1(token) {
  const res = await m1Request('/auth/validar-identidad-y-rol', { token });
  if (res.status !== 200 || res.data?.valid !== true) {
    throw new Error(
      `M1 validar-identidad-y-rol falló (${res.status}): ${JSON.stringify(res.data)}`
    );
  }
  return res.data;
}

/**
 * Flujo completo: registrar + login + validar.
 * Devuelve ids canónicos de M1 listos para usar en M3.
 */
async function crearSesionM1(rol = 'CONDUCTOR', extras = {}) {
  await ensureM1Healthy();
  const registrado = await registrarUsuarioM1({ rol, ...extras });
  const sesion = await iniciarSesionM1(registrado.email, registrado.password);
  const identidad = await validarIdentidadM1(sesion.token);

  const userId = String(identidad.userId ?? sesion.usuario?.id ?? registrado.usuario?.id);

  return {
    userId,
    role: identidad.role,
    token: sesion.token,
    email: registrado.email,
    password: registrado.password,
    usuario: sesion.usuario || registrado.usuario
  };
}

module.exports = {
  M1_URL,
  m1Request,
  ensureM1Healthy,
  registrarUsuarioM1,
  iniciarSesionM1,
  validarIdentidadM1,
  crearSesionM1
};

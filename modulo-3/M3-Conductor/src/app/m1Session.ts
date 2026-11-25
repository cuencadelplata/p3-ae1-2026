/**
 * Sesión compartida de M1 (Identidad y Acceso) para las pantallas de M3:
 *   - alta-conductor.html
 *   - valoraciones.html
 *
 * Usa el proxy /m1-api/ de nginx (-> m1-identidad-acceso:3001) para evitar CORS
 * y guarda m1.token + m1.usuario en sessionStorage para compartir sesión entre pantallas.
 */

export const CLAVE_IDENTIDAD = "m1.usuario";
export const CLAVE_TOKEN = "m1.token";

export type UsuarioM1 = {
  id: number | string;
  nombre?: string;
  apellido?: string;
  dni?: string;
  telefono?: string;
  email?: string;
  rol?: string;
  estado?: string;
};

export type SesionM1 = {
  token: string;
  usuario: UsuarioM1;
};

function leerAlmacen(clave: string): string | null {
  try {
    return window.sessionStorage.getItem(clave) ?? window.localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function guardarAlmacen(clave: string, valor: string) {
  try {
    window.sessionStorage.setItem(clave, valor);
  } catch {
    /* sin storage */
  }
}

function borrarAlmacen(clave: string) {
  try {
    window.sessionStorage.removeItem(clave);
    window.localStorage.removeItem(clave);
  } catch {
    /* sin storage */
  }
}

export function urlM1(ruta: string): string {
  const params = new URLSearchParams(window.location.search);
  const porUrl = params.get("m1Url");
  if (porUrl) guardarAlmacen("m1.url", porUrl);
  const guardada = leerAlmacen("m1.url");
  if (porUrl || guardada) {
    return `${(porUrl || guardada || "").replace(/\/$/, "")}${ruta}`;
  }
  const { port, pathname, hostname } = window.location;
  const preview = pathname.includes("/public/") || port === "3001";
  if (preview) {
    return `http://${hostname || "localhost"}:10000${ruta}`;
  }
  return `/m1-api${ruta}`;
}

export function normalizarUsuarioM1(dato: unknown): UsuarioM1 | null {
  if (!dato || typeof dato !== "object") return null;
  const crudo = ("usuario" in dato ? (dato as { usuario: unknown }).usuario : dato) as Record<string, unknown>;
  const id = crudo?.id ?? crudo?.userId;
  if (id === undefined || id === null || id === "") return null;
  const texto = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
  return {
    id: String(id),
    nombre: texto(crudo.nombre),
    apellido: texto(crudo.apellido),
    dni: texto(crudo.dni),
    telefono: texto(crudo.telefono),
    email: texto(crudo.email),
    rol: texto(crudo.rol ?? crudo.role),
    estado: texto(crudo.estado)
  };
}

export function obtenerTokenM1(): string | null {
  return leerAlmacen(CLAVE_TOKEN);
}

export function headersAuthM1(): Record<string, string> {
  const token = obtenerTokenM1();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function guardarSesionM1(token: string, usuario: UsuarioM1) {
  guardarAlmacen(CLAVE_TOKEN, token);
  guardarAlmacen(CLAVE_IDENTIDAD, JSON.stringify(usuario));
}

export function cerrarSesionM1() {
  borrarAlmacen(CLAVE_TOKEN);
  borrarAlmacen(CLAVE_IDENTIDAD);
}

export async function validarTokenConM1(token: string): Promise<UsuarioM1> {
  const res = await fetch(urlM1("/auth/me"), {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    }
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const mensaje = (data && (data.error || data.message)) || "Sesión de M1 expirada o inválida";
    const err = new Error(String(mensaje)) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const usuario = normalizarUsuarioM1(data);
  if (!usuario) {
    throw new Error("M1 devolvió un perfil sin userId");
  }
  return usuario;
}

export async function iniciarSesionM1(email: string, password: string): Promise<SesionM1> {
  const res = await fetch(urlM1("/auth/iniciar-sesion"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ email: email.trim(), password })
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.token) {
    const mensaje = (data && (data.error || data.message)) || "No se pudo iniciar sesión en M1";
    throw new Error(String(mensaje));
  }

  const token = String(data.token);
  let usuario = normalizarUsuarioM1(data);
  if (!usuario) {
    usuario = await validarTokenConM1(token);
  }
  if (usuario.rol && usuario.rol.toUpperCase() !== "CONDUCTOR") {
    throw new Error(`Esta cuenta tiene rol ${usuario.rol}. Ingresá con una cuenta CONDUCTOR de M1.`);
  }
  guardarSesionM1(token, usuario);
  return { token, usuario };
}

/**
 * Resuelve la sesión real de M1 al cargar la pantalla:
 *  1. ?token=<jwt> en la URL (lo valida contra M1 /auth/me y lo limpia de la URL)
 *  2. Token guardado en sessionStorage/localStorage (revalidado contra /auth/me)
 */
export async function resolverSesionM1(): Promise<SesionM1 | null> {
  const params = new URLSearchParams(window.location.search);
  const tokenUrl = params.get("token");
  if (tokenUrl) {
    try {
      const usuario = await validarTokenConM1(tokenUrl);
      guardarSesionM1(tokenUrl, usuario);
      params.delete("token");
      const qs = params.toString();
      window.history.replaceState({}, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
      return { token: tokenUrl, usuario };
    } catch {
      cerrarSesionM1();
      return null;
    }
  }

  const tokenGuardado = obtenerTokenM1();
  if (!tokenGuardado) return null;

  try {
    const usuario = await validarTokenConM1(tokenGuardado);
    guardarSesionM1(tokenGuardado, usuario);
    return { token: tokenGuardado, usuario };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 401 || status === 403) {
      cerrarSesionM1();
      return null;
    }
    const raw = leerAlmacen(CLAVE_IDENTIDAD);
    const usuario = raw ? normalizarUsuarioM1(JSON.parse(raw)) : null;
    return usuario ? { token: tokenGuardado, usuario } : null;
  }
}

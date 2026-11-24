import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

/**
 * Alta de conductor (mismo look que valoraciones.tsx), en 5 pasos:
 *   1. "Alta de conductor": identidad de M1 (solo lectura) + tipo de vehículo.
 *      -> GET/POST /api/conductores, PATCH /api/conductores/:id (cambiar tipo al volver)
 *   2. "Datos del vehículo" (con Volver): patente / marca / modelo / año.
 *      -> POST y GET /api/v1/drivers/:driverId/vehicles (m3-vehiculos)
 *   3. "Cédula del vehículo": fotos de frente y dorso, asociadas al vehículo cargado.
 *      -> POST y GET /api/v1/drivers/:driverId/documents (CEDULA_VEHICULO + vehicleId + cara)
 *   4. "Licencia de conducir": fotos de frente y dorso.
 *      -> POST y GET /api/v1/drivers/:driverId/documents (LICENCIA_CONDUCIR + cara)
 *   5. Pantalla final: neutral ("Completá tu información" / "En revisión") hasta que la
 *      información esté completa Y las 4 fotos aprobadas; recién ahí se muestra la habilitación.
 *
 * El estado de habilitación (habilitado de M3, estado de M1, estado de documentos) NO se
 * muestra antes de eso.
 *
 * Bundle: npm run build:app  ->  public/alta-conductor.js (servido por public/alta-conductor.html)
 */

const LIMA = "#D5FF40";
const GRIS = "#C0C2B8";
const BLANCO = "#FFFFFF";
const FONDO = "#0C0C0C";
const TARJETA = "#141414";

// Valores de TipoServicio en m3-vehiculos (vehiculo-model.ts / openapi.yaml)
const TIPOS = [
  { valor: "AUTO", nombre: "Auto", detalle: "Viajes en auto" },
  { valor: "MOTO", nombre: "Moto", detalle: "Viajes en moto" }
] as const;
type TipoServicio = (typeof TIPOS)[number]["valor"];

// Misma regla que vehiculo-service.ts
const PATENTE_REGEX = /^([A-Z]{3}[0-9]{3}|[A-Z]{2}[0-9]{3}[A-Z]{2})$/;
const CLAVE_SESION = "m3.tokenM1";

// Fotos de licencia
const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/webp"];
const MAX_FOTO_BYTES = 8 * 1024 * 1024; // archivo original
// m3-vehiculos usa express.json() con el límite por defecto (100 kB por request):
// la foto se comprime a JPEG para que la data URL entre holgada en ese límite.
const MAX_DATA_URL = 90_000;

type Paso = "alta" | "vehiculo" | "cedula" | "licencia" | "final";
const ORDEN_PASOS: Paso[] = ["alta", "vehiculo", "cedula", "licencia", "final"];

// UserResponse de M1 (src/api/autenticacion/m1-Auth-openapi.yaml)
type UsuarioM1 = {
  userId: number;
  nombre?: string;
  apellido?: string;
  dni?: string;
  telefono?: string;
  email?: string;
  rol?: string;
  estado?: string;
};

type Conductor = {
  usuarioID: string;
  ciudad?: string;
  tipovehiculo?: string;
  habilitado?: string;
  estado_conexion?: string;
  createdAt?: string;
};

type Vehiculo = {
  id: string;
  driverId: string;
  patente: string;
  marca: string | null;
  modelo: string | null;
  anio: number;
  tipoServicio: string;
  activo: boolean;
  createdAt?: string;
};

type Documento = {
  id: string;
  driverId: string;
  vehicleId?: string | null;
  tipoDocumento: string;
  numeroDocumento: string;
  fechaVencimiento: string;
  archivoUrl: string;
  cara?: "FRENTE" | "DORSO" | null;
  estado?: string;
  createdAt?: string;
};

// ---------- URLs ----------

function urlApi(ruta: string) {
  return ruta;
}
const urlVehiculos = (driverId: string) => `/api/v1/drivers/${encodeURIComponent(driverId)}/vehicles`;
const urlDocumentos = (driverId: string) => `/api/v1/drivers/${encodeURIComponent(driverId)}/documents`;
const urlConductor = (driverId: string) => urlApi(`/api/conductores/${encodeURIComponent(driverId)}`);

// ---------- Identidad de M1 ----------

async function cargarSesion(token: string, signal?: AbortSignal) {
  const respuesta = await fetch(urlApi("/auth/me"), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal
  });
  if (respuesta.status === 401 || respuesta.status === 403) {
    throw new Error("Volvé a iniciar sesión en M1 para continuar.");
  }
  if (!respuesta.ok) throw new Error("No se pudo verificar tu sesión con M1.");
  const usuario: UsuarioM1 = await respuesta.json();
  if (!Number.isSafeInteger(usuario.userId) || usuario.userId <= 0) {
    throw new Error("M1 no devolvió un ID de usuario válido.");
  }
  if (usuario.rol !== "CONDUCTOR" || usuario.estado !== "ACTIVO") {
    throw new Error("Necesitás una cuenta activa de conductor para continuar.");
  }
  return { usuario, token };
}
function aTipo(valor?: string): TipoServicio | "" {
  const tipo = String(valor || "").toUpperCase();
  return tipo === "AUTO" || tipo === "MOTO" ? tipo : "";
}

const nombreTipo = (tipo: TipoServicio | "") => (tipo === "MOTO" ? "moto" : "auto");

async function leerJson(respuesta: Response) {
  return respuesta.json().catch(() => ({}));
}

function mensajeDe(error: unknown, porDefecto: string) {
  if (error instanceof TypeError) return `${porDefecto}: no hay conexión con el servicio`;
  return error instanceof Error ? error.message : porDefecto;
}

async function pedirJson<T>(url: string, porDefecto: string, init?: RequestInit): Promise<T> {
  const respuesta = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init?.headers || {}) } });
  const cuerpo = await leerJson(respuesta);
  if (!respuesta.ok) throw new Error((cuerpo as { error?: string }).error || porDefecto);
  return cuerpo as T;
}

// Fecha de calendario (vencimiento): m3-vehiculos la devuelve como medianoche UTC,
// así que se toma solo AAAA-MM-DD para no correrla un día en Argentina.
function fechaCalendario(iso?: string) {
  const dia = /^\d{4}-\d{2}-\d{2}/.exec(iso || "")?.[0];
  return dia ? fechaDe(`${dia}T12:00:00`) : "—";
}

function fechaDe(iso?: string) {
  if (!iso) return "—";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "—";
  return fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function nuevaClave() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function irA(paso: Paso, driverId?: string) {
  const params = new URLSearchParams(window.location.search);
  params.set("paso", paso);
  if (driverId) params.set("driverId", driverId);
  // la identidad ya quedó en sessionStorage; no se arrastra en la URL
  for (const clave of ["usuario", "id", "userId", "nombre", "apellido", "dni", "telefono", "email", "rol", "role", "estado", "demo"]) {
    params.delete(clave);
  }
  window.history.pushState({}, "", `${window.location.pathname}?${params.toString()}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

type TipoDocumento = "LICENCIA_CONDUCIR" | "CEDULA_VEHICULO";

// Última foto subida de cada cara de un documento (la cédula, además, del vehículo indicado)
function documentoPorCara(documentos: Documento[], tipo: TipoDocumento, vehicleId?: string) {
  const fotos = documentos
    .filter(
      (d) =>
        d.tipoDocumento === tipo &&
        (d.cara === "FRENTE" || d.cara === "DORSO") &&
        (vehicleId === undefined || d.vehicleId === vehicleId)
    )
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  const ultima: Partial<Record<"FRENTE" | "DORSO", Documento>> = {};
  for (const doc of fotos) ultima[doc.cara as "FRENTE" | "DORSO"] = doc;
  return ultima;
}

// Vehículo vigente del conductor: el último cargado del tipo elegido (m3-vehiculos lista del más nuevo al más viejo)
function vehiculoActual(vehiculos: Vehiculo[], tipo: TipoServicio | "") {
  if (!tipo) return null;
  return (
    vehiculos
      .filter((v) => v.tipoServicio === tipo)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0] || null
  );
}

// ---------- Imagen: validación + compresión ----------

function cargarImagen(archivo: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen"));
    };
    img.src = url;
  });
}

async function comprimirFoto(archivo: File): Promise<string> {
  const img = await cargarImagen(archivo);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("El navegador no puede procesar la imagen");

  for (const lado of [1400, 1200, 1000, 860, 720, 600]) {
    const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const calidad of [0.82, 0.7, 0.6, 0.5]) {
      const dataUrl = canvas.toDataURL("image/jpeg", calidad);
      if (dataUrl.length <= MAX_DATA_URL) return dataUrl;
    }
  }
  throw new Error("La foto es demasiado pesada aun comprimida. Probá con otra.");
}

function problemaArchivo(archivo: File) {
  if (!TIPOS_IMAGEN.includes(archivo.type)) return "Usá una foto JPG, PNG o WEBP";
  if (archivo.size > MAX_FOTO_BYTES) return "La foto supera los 8 MB";
  if (archivo.size === 0) return "El archivo está vacío";
  return "";
}

// ---------- Piezas visuales ----------

function Par({ izq, der }: { izq: [string, string | undefined]; der: [string, string | undefined] }) {
  return (
    <div className="val-ruta">
      <div>
        <p className="val-lugar" title={izq[1] || ""}>{izq[1] || "—"}</p>
        <p className="val-etiqueta">{izq[0]}</p>
      </div>
      <div className="val-ruta-destino">
        <p className="val-lugar" title={der[1] || ""}>{der[1] || "—"}</p>
        <p className="val-etiqueta">{der[0]}</p>
      </div>
    </div>
  );
}

function Pasos({ actual }: { actual: Paso }) {
  const indice = ORDEN_PASOS.indexOf(actual);
  return (
    <div className="val-pasos" aria-label={`Paso ${indice + 1} de ${ORDEN_PASOS.length}`}>
      {ORDEN_PASOS.map((paso, i) => (
        <span key={paso} className={i <= indice ? "activo" : ""} />
      ))}
    </div>
  );
}

function Cargando({ texto }: { texto: string }) {
  return (
    <article className="val-card">
      <p className="val-etiqueta">{texto}</p>
    </article>
  );
}

// Identidad de M1: solo datos de registro, sin rol/estado de la cuenta
function TarjetaIdentidad({ usuario }: { usuario: UsuarioM1 }) {
  return (
    <article className="val-card">
      <h2 className="val-card-titulo">Identidad recibida de M1</h2>
      <Par izq={["Nombre", usuario.nombre]} der={["Apellido", usuario.apellido]} />
      <Par izq={["DNI", usuario.dni]} der={["Teléfono", usuario.telefono]} />
      <Par izq={["Email", usuario.email]} der={["ID de usuario", String(usuario.userId)]} />
    </article>
  );
}

function SelectorTipo({
  tipo,
  onChange,
  deshabilitado
}: {
  tipo: TipoServicio | "";
  onChange: (tipo: TipoServicio) => void;
  deshabilitado?: boolean;
}) {
  return (
    <div className="val-opciones" role="radiogroup" aria-label="Tipo de vehículo">
      {TIPOS.map((opcion) => (
        <button
          key={opcion.valor}
          type="button"
          role="radio"
          aria-checked={tipo === opcion.valor}
          className="val-opcion"
          disabled={deshabilitado}
          onClick={() => onChange(opcion.valor)}
        >
          {opcion.nombre}
          <small>{opcion.detalle}</small>
        </button>
      ))}
    </div>
  );
}

// ---------- Paso 1: alta de conductor / tipo de vehículo ----------

function PasoAlta({ usuario, token }: Awaited<ReturnType<typeof cargarSesion>>) {
  const [tipo, setTipo] = useState<TipoServicio | "">("");
  const [existente, setExistente] = useState<Conductor | null>(null);
  const [verificando, setVerificando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Si el conductor ya existe en M3 no se vuelve a crear: se puede cambiar el tipo
    fetch(urlConductor(String(usuario.userId)))
      .then(async (res) => {
        if (res.ok) {
          const conductor = (await res.json()) as Conductor;
          setExistente(conductor);
          setTipo(aTipo(conductor.tipovehiculo));
        }
      })
      .catch(() => setError("No hay conexión con la API de conductores"))
      .finally(() => setVerificando(false));
  }, []);

  async function continuar() {
    if (!tipo || enviando) return;
    const id = String(usuario.userId);
    setEnviando(true);
    setError("");
    try {
      if (!existente) {
        await pedirJson(urlApi("/api/conductores"), "No se pudo crear el conductor", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          // M3 guarda el tipo en minúscula ("auto" / "moto"), como sus datos existentes
          body: JSON.stringify({ usuarioID: id, tipovehiculo: tipo.toLowerCase() })
        });
      } else if (aTipo(existente.tipovehiculo) !== tipo) {
        await pedirJson(urlConductor(id), "No se pudo cambiar el tipo de vehículo", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tipovehiculo: tipo.toLowerCase() })
        });
      }
      irA("vehiculo", id);
    } catch (e) {
      setError(mensajeDe(e, "No se pudo guardar el conductor"));
      setEnviando(false);
    }
  }

  const tipoActual = existente ? aTipo(existente.tipovehiculo) : "";
  const textoBoton = enviando
    ? "Guardando…"
    : !existente
      ? "Crear conductor"
      : tipo && tipo !== tipoActual
        ? `Cambiar a ${nombreTipo(tipo)}`
        : "Continuar";

  return (
    <>
      <Pasos actual="alta" />
      <h1>Alta de conductor</h1>
      <p className="val-subtitulo">Datos de registro de M1</p>

      {verificando ? <Cargando texto="Buscando conductor en M3…" /> : null}

      {!verificando ? (
        <article className="val-card">
          <p className="val-calificar">{existente ? "Tipo de vehículo" : "¿Con qué vas a manejar?"}</p>
          <SelectorTipo
            tipo={tipo}
            deshabilitado={enviando}
            onChange={(nuevo) => {
              setTipo(nuevo);
              setError("");
            }}
          />
          <p className="val-juicio">
            {!tipo
              ? "Elegí un tipo de vehículo"
              : existente && tipo !== tipoActual
                ? `Vas a cambiar de ${nombreTipo(tipoActual)} a ${nombreTipo(tipo)}`
                : `Tipo de servicio: ${tipo}`}
          </p>

          {error ? <p className="val-error">{error}</p> : null}

          <button type="button" className="val-enviar" disabled={!tipo || enviando} onClick={continuar}>
            {textoBoton}
          </button>
        </article>
      ) : null}
    </>
  );
}

// ---------- Paso 2: datos del vehículo ----------

type Formulario = { patente: string; marca: string; modelo: string; anio: string };
const formularioVacio = (): Formulario => ({ patente: "", marca: "", modelo: "", anio: "" });

function validar(form: Formulario): string {
  const patente = form.patente.trim().toUpperCase();
  if (!patente) return "Falta la patente";
  if (!PATENTE_REGEX.test(patente)) return "Patente inválida, formato AAA000 o AA000AA";
  const anio = Number(form.anio);
  const anioActual = new Date().getFullYear();
  if (!Number.isInteger(anio) || anio < 1990 || anio > anioActual + 1) return `Año inválido (1990 a ${anioActual + 1})`;
  return "";
}

function PasoVehiculo({ driverId, usuario }: { driverId: string; usuario: UsuarioM1 }) {
  const [conductor, setConductor] = useState<Conductor | null>(null);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState("");
  const [form, setForm] = useState<Formulario>(formularioVacio);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [cargandoVehiculos, setCargandoVehiculos] = useState(true);
  const [avisoVehiculos, setAvisoVehiculos] = useState("");


  const tipo = aTipo(conductor?.tipovehiculo);
  const delTipo = vehiculos.filter((v) => v.tipoServicio === tipo);

  async function cargarVehiculos() {
    setCargandoVehiculos(true);
    try {
      const lista = await pedirJson<Vehiculo[]>(urlVehiculos(driverId), "No se pudieron leer los vehículos");
      setVehiculos(Array.isArray(lista) ? lista : []);
      setAvisoVehiculos("");
    } catch (e) {
      setAvisoVehiculos(mensajeDe(e, "No se pudieron leer los vehículos de m3-vehiculos"));
    } finally {
      setCargandoVehiculos(false);
    }
  }

  useEffect(() => {
    pedirJson<Conductor>(urlConductor(driverId), "No se encontró el conductor")
      .then(setConductor)
      .catch((e) => setAviso(mensajeDe(e, "No se pudo leer el conductor")))
      .finally(() => setCargando(false));
    cargarVehiculos();
  }, [driverId]);

  function cambiar(campo: keyof Formulario, valor: string) {
    setForm((actual) => ({ ...actual, [campo]: campo === "patente" ? valor.toUpperCase() : valor }));
    setError("");
    setOk("");
  }

  async function guardar() {
    if (!tipo || enviando) return;
    const problema = validar(form);
    if (problema) {
      setError(problema);
      return;
    }
    setEnviando(true);
    setError("");
    setOk("");
    try {
      const vehiculo = await pedirJson<Vehiculo>(urlVehiculos(driverId), "No se pudo guardar el vehículo", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": nuevaClave() },
        body: JSON.stringify({
          patente: form.patente.trim().toUpperCase(),
          marca: form.marca.trim() || undefined,
          modelo: form.modelo.trim() || undefined,
          anio: Number(form.anio),
          tipoServicio: tipo
        })
      });
      setOk(`Vehículo ${vehiculo.patente} guardado en m3-vehiculos`);
      setForm(formularioVacio());
      await cargarVehiculos();
    } catch (e) {
      setError(mensajeDe(e, "No se pudo guardar el vehículo"));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Pasos actual="vehiculo" />
      <h1>Datos del vehículo</h1>
      <p className="val-subtitulo">{tipo ? `Tu ${nombreTipo(tipo)} para viajar` : "Vehículo del conductor"}</p>

      {cargando ? <Cargando texto="Buscando conductor…" /> : null}

      {!cargando && aviso ? (
        <>
          <p className="val-error val-aviso">{aviso}</p>
          <button type="button" className="val-secundario" onClick={() => irA("alta")}>
            Volver al alta
          </button>
        </>
      ) : null}

      {!cargando && conductor ? (
        <article className="val-card">
          <h2 className="val-card-titulo">Conductor</h2>
          <Par
            izq={["Nombre", usuario ? [usuario.nombre, usuario.apellido].filter(Boolean).join(" ") : undefined]}
            der={["ID de usuario", conductor.usuarioID]}
          />
          <Par izq={["Tipo de vehículo", tipo || conductor.tipovehiculo]} der={["Vehículos cargados", String(delTipo.length)]} />
        </article>
      ) : null}

      {!cargando && conductor && !tipo ? (
        <p className="val-error val-aviso">El tipo de vehículo no es válido para m3-vehiculos (solo AUTO o MOTO). Volvé y elegí uno.</p>
      ) : null}

      {!cargando && conductor && tipo ? (
        <article className="val-card">
          <p className="val-calificar">Cargá tu {nombreTipo(tipo)}</p>

          <label className="val-comentario">
            <span>Patente</span>
            <input
              value={form.patente}
              maxLength={7}
              placeholder="AB123CD o ABC123"
              autoComplete="off"
              disabled={enviando}
              onChange={(e) => cambiar("patente", e.target.value)}
            />
          </label>
          <div className="val-fila">
            <label className="val-comentario">
              <span>Marca</span>
              <input value={form.marca} maxLength={40} placeholder={tipo === "AUTO" ? "Toyota" : "Honda"} disabled={enviando} onChange={(e) => cambiar("marca", e.target.value)} />
            </label>
            <label className="val-comentario">
              <span>Modelo</span>
              <input value={form.modelo} maxLength={40} placeholder={tipo === "AUTO" ? "Corolla" : "Wave"} disabled={enviando} onChange={(e) => cambiar("modelo", e.target.value)} />
            </label>
          </div>
          <div className="val-fila">
            <label className="val-comentario">
              <span>Año</span>
              <input
                type="number"
                inputMode="numeric"
                min={1990}
                max={new Date().getFullYear() + 1}
                value={form.anio}
                placeholder="2020"
                disabled={enviando}
                onChange={(e) => cambiar("anio", e.target.value)}
              />
            </label>
            <label className="val-comentario">
              <span>Tipo de servicio</span>
              <input value={tipo} disabled readOnly />
            </label>
          </div>

          {error ? <p className="val-error">{error}</p> : null}
          {ok ? <p className="val-ok">{ok}</p> : null}

          <button type="button" className="val-enviar" disabled={enviando || !form.patente || !form.anio} onClick={guardar}>
            {enviando ? "Guardando…" : "Guardar vehículo"}
          </button>
        </article>
      ) : null}

      <section className="val-historial">
        <h2>Guardados</h2>
        <p className="val-etiqueta val-origen">Leído de m3-vehiculos</p>

        {cargandoVehiculos ? <Cargando texto="Buscando vehículos…" /> : null}

        {!cargandoVehiculos && avisoVehiculos ? <p className="val-error val-aviso">{avisoVehiculos}</p> : null}

        {!cargandoVehiculos && !avisoVehiculos && vehiculos.length === 0 ? (
          <article className="val-card">
            <h2 className="val-card-titulo">Sin vehículos</h2>
            <p className="val-vacio">Cuando guardes tu vehículo aparece acá, leído desde m3-vehiculos.</p>
          </article>
        ) : null}

        {vehiculos.map((vehiculo) => (
          <article key={vehiculo.id} className="val-mini">
            <div>
              <p className="val-lugar">{vehiculo.patente}</p>
              <p className="val-etiqueta">
                {[vehiculo.marca, vehiculo.modelo].filter(Boolean).join(" ") || "Sin marca"} · {vehiculo.anio}
              </p>
              <p className="val-mini-nota">Alta {fechaDe(vehiculo.createdAt)}</p>
            </div>
            <div className="val-ruta-destino">
              <p className="val-mini-nota val-mini-puntos">{vehiculo.tipoServicio}</p>
              {tipo && vehiculo.tipoServicio !== tipo ? <p className="val-mini-nota">Otro tipo</p> : null}
            </div>
          </article>
        ))}
      </section>

      {!cargando && conductor ? (
        <div className="val-acciones">
          <button type="button" className="val-secundario" onClick={() => irA("alta", driverId)}>
            Volver
          </button>
          <button type="button" className="val-enviar" disabled={delTipo.length === 0} onClick={() => irA("cedula", driverId)}>
            Continuar
          </button>
        </div>
      ) : null}
      {!cargando && conductor && tipo && delTipo.length === 0 ? (
        <p className="val-juicio">Guardá tu {nombreTipo(tipo)} para continuar. ¿Elegiste mal el tipo? Tocá Volver.</p>
      ) : null}
    </>
  );
}

// ---------- Pasos 3 y 4: documentos con foto de frente y dorso (cédula del vehículo, licencia) ----------

type Foto = { nombre: string; dataUrl: string; peso: number };
type Cara = "FRENTE" | "DORSO";

type ConfigDocumento = {
  tipoDocumento: TipoDocumento;
  paso: Paso;
  anterior: Paso;
  siguiente: Paso;
  titulo: string;
  subtitulo: string;
  consigna: string;
  nombre: string; // "licencia" / "cédula" (para textos y etiquetas accesibles)
  etiquetaNumero: string;
  placeholderNumero: string;
  vacio: string;
  requiereVehiculo: boolean;
};

// CEDULA_VEHICULO ya existe en m3-vehiculos (documents-model.ts) y exige vehicleId
const CEDULA: ConfigDocumento = {
  tipoDocumento: "CEDULA_VEHICULO",
  paso: "cedula",
  anterior: "vehiculo",
  siguiente: "licencia",
  titulo: "Cédula del vehículo",
  subtitulo: "Cédula verde del vehículo que cargaste",
  consigna: "Frente y dorso de la cédula",
  nombre: "cédula",
  etiquetaNumero: "Número de cédula",
  placeholderNumero: "ABC12345",
  vacio: "Cuando subas la cédula, el frente y el dorso aparecen acá, leídos desde m3-vehiculos.",
  requiereVehiculo: true
};

const LICENCIA: ConfigDocumento = {
  tipoDocumento: "LICENCIA_CONDUCIR",
  paso: "licencia",
  anterior: "cedula",
  siguiente: "final",
  titulo: "Licencia de conducir",
  subtitulo: "Fotos para validar tu identidad",
  consigna: "Frente y dorso de tu licencia",
  nombre: "licencia",
  etiquetaNumero: "Número de licencia",
  placeholderNumero: "12345678",
  vacio: "Cuando subas tu licencia, el frente y el dorso aparecen acá, leídos desde m3-vehiculos.",
  requiereVehiculo: false
};

function manianaISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0]!;
}

function SelectorFoto({
  cara,
  nombre,
  foto,
  procesando,
  deshabilitado,
  onArchivo,
  onQuitar
}: {
  cara: Cara;
  nombre: string;
  foto: Foto | null;
  procesando: boolean;
  deshabilitado: boolean;
  onArchivo: (archivo: File) => void;
  onQuitar: () => void;
}) {
  const etiqueta = cara === "FRENTE" ? "Frente" : "Dorso";
  return (
    <div className="val-foto">
      <label className={foto ? "val-foto-caja val-foto-lista" : "val-foto-caja"}>
        <input
          type="file"
          accept={TIPOS_IMAGEN.join(",")}
          capture="environment"
          aria-label={`Foto del ${etiqueta.toLowerCase()} de la ${nombre}`}
          disabled={deshabilitado}
          onChange={(e) => {
            const archivo = e.target.files?.[0];
            e.target.value = "";
            if (archivo) onArchivo(archivo);
          }}
        />
        {foto ? (
          <img src={foto.dataUrl} alt={`${etiqueta} de la ${nombre}`} />
        ) : (
          <span className="val-foto-vacia">
            <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M9 4.5 7.6 6.5H5A2 2 0 0 0 3 8.5v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-2.6L15 4.5H9Zm3 4.25a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 1.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z"
                fill={LIMA}
              />
            </svg>
            {procesando ? "Procesando…" : "Sacar o elegir foto"}
          </span>
        )}
      </label>
      <div className="val-foto-pie">
        <p className="val-hora">{etiqueta}</p>
        {foto ? (
          <button type="button" className="val-link" disabled={deshabilitado} onClick={onQuitar}>
            Cambiar
          </button>
        ) : (
          <p className="val-etiqueta">Sin foto</p>
        )}
      </div>
    </div>
  );
}

function PasoDocumento({ driverId, config }: { driverId: string; config: ConfigDocumento }) {
  const [numero, setNumero] = useState("");
  const [vencimiento, setVencimiento] = useState("");
  const [fotos, setFotos] = useState<Record<Cara, Foto | null>>({ FRENTE: null, DORSO: null });
  const [procesando, setProcesando] = useState<Cara | "">("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [cargandoDocs, setCargandoDocs] = useState(true);
  const [avisoDocs, setAvisoDocs] = useState("");
  // Solo para la cédula: vehículo al que se asocia
  const [vehiculo, setVehiculo] = useState<Vehiculo | null>(null);
  const [cargandoVehiculo, setCargandoVehiculo] = useState(config.requiereVehiculo);
  const [avisoVehiculo, setAvisoVehiculo] = useState("");

  const vehicleId = config.requiereVehiculo ? vehiculo?.id : undefined;
  const guardadas = config.requiereVehiculo && !vehicleId ? {} : documentoPorCara(documentos, config.tipoDocumento, vehicleId);
  const completas = Boolean(guardadas.FRENTE && guardadas.DORSO);

  async function cargarDocumentos() {
    setCargandoDocs(true);
    try {
      const lista = await pedirJson<Documento[]>(urlDocumentos(driverId), "No se pudieron leer los documentos");
      setDocumentos(Array.isArray(lista) ? lista : []);
      setAvisoDocs("");
    } catch (e) {
      setAvisoDocs(mensajeDe(e, "No se pudieron leer los documentos de m3-vehiculos"));
    } finally {
      setCargandoDocs(false);
    }
  }

  useEffect(() => {
    cargarDocumentos();
    if (config.requiereVehiculo) {
      Promise.all([
        pedirJson<Conductor>(urlConductor(driverId), "No se encontró el conductor"),
        pedirJson<Vehiculo[]>(urlVehiculos(driverId), "No se pudieron leer los vehículos")
      ])
        .then(([conductor, vehiculos]) => {
          const actual = vehiculoActual(Array.isArray(vehiculos) ? vehiculos : [], aTipo(conductor.tipovehiculo));
          setVehiculo(actual);
          if (!actual) setAvisoVehiculo("Primero cargá los datos de tu vehículo.");
        })
        .catch((e) => setAvisoVehiculo(mensajeDe(e, "No se pudo leer tu vehículo")))
        .finally(() => setCargandoVehiculo(false));
    }
  }, [driverId, config.paso]);

  async function elegir(cara: Cara, archivo: File) {
    setError("");
    setOk("");
    const problema = problemaArchivo(archivo);
    if (problema) {
      setError(`${cara === "FRENTE" ? "Frente" : "Dorso"}: ${problema}`);
      return;
    }
    setProcesando(cara);
    try {
      const dataUrl = await comprimirFoto(archivo);
      setFotos((actual) => ({ ...actual, [cara]: { nombre: archivo.name, dataUrl, peso: dataUrl.length } }));
    } catch (e) {
      setError(mensajeDe(e, "No se pudo procesar la foto"));
    } finally {
      setProcesando("");
    }
  }

  async function subir() {
    if (enviando) return;
    if (config.requiereVehiculo && !vehicleId) return setError("Primero cargá los datos de tu vehículo");
    if (!numero.trim()) return setError(`Falta el ${config.etiquetaNumero.toLowerCase()}`);
    if (!vencimiento || vencimiento < manianaISO()) return setError("La fecha de vencimiento tiene que ser futura");
    if (!fotos.FRENTE || !fotos.DORSO) return setError("Faltan las fotos de frente y dorso");

    setEnviando(true);
    setError("");
    setOk("");
    try {
      for (const cara of ["FRENTE", "DORSO"] as const) {
        await pedirJson<Documento>(urlDocumentos(driverId), `No se pudo subir el ${cara.toLowerCase()}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": nuevaClave() },
          body: JSON.stringify({
            tipoDocumento: config.tipoDocumento,
            ...(vehicleId ? { vehicleId } : {}),
            cara,
            numeroDocumento: numero.trim(),
            fechaVencimiento: vencimiento,
            archivoUrl: fotos[cara]!.dataUrl
          })
        });
      }
      setOk(`Fotos de la ${config.nombre} guardadas en m3-vehiculos`);
      setFotos({ FRENTE: null, DORSO: null });
      await cargarDocumentos();
    } catch (e) {
      setError(mensajeDe(e, "No se pudieron subir las fotos"));
      await cargarDocumentos();
    } finally {
      setEnviando(false);
    }
  }

  const bloqueado = config.requiereVehiculo && !vehicleId;
  const listo = Boolean(!bloqueado && numero.trim() && vencimiento && fotos.FRENTE && fotos.DORSO);

  return (
    <>
      <Pasos actual={config.paso} />
      <h1>{config.titulo}</h1>
      <p className="val-subtitulo">{config.subtitulo}</p>

      {config.requiereVehiculo && cargandoVehiculo ? <Cargando texto="Buscando tu vehículo…" /> : null}
      {config.requiereVehiculo && !cargandoVehiculo && avisoVehiculo ? <p className="val-error val-aviso">{avisoVehiculo}</p> : null}
      {config.requiereVehiculo && vehiculo ? (
        <article className="val-card">
          <h2 className="val-card-titulo">Vehículo</h2>
          <Par izq={["Patente", vehiculo.patente]} der={["Tipo", vehiculo.tipoServicio]} />
          <Par
            izq={["Marca y modelo", [vehiculo.marca, vehiculo.modelo].filter(Boolean).join(" ") || undefined]}
            der={["Año", String(vehiculo.anio)]}
          />
        </article>
      ) : null}

      {!bloqueado || !config.requiereVehiculo ? (
        <article className="val-card">
          <p className="val-calificar">{config.consigna}</p>
          <div className="val-fotos">
            {(["FRENTE", "DORSO"] as const).map((cara) => (
              <SelectorFoto
                key={cara}
                cara={cara}
                nombre={config.nombre}
                foto={fotos[cara]}
                procesando={procesando === cara}
                deshabilitado={enviando || procesando !== "" || bloqueado}
                onArchivo={(archivo) => elegir(cara, archivo)}
                onQuitar={() => setFotos((actual) => ({ ...actual, [cara]: null }))}
              />
            ))}
          </div>

          <div className="val-fila">
            <label className="val-comentario">
              <span>{config.etiquetaNumero}</span>
              <input
                value={numero}
                maxLength={30}
                placeholder={config.placeholderNumero}
                autoComplete="off"
                disabled={enviando || bloqueado}
                onChange={(e) => {
                  setNumero(e.target.value);
                  setError("");
                }}
              />
            </label>
            <label className="val-comentario">
              <span>Vencimiento</span>
              <input
                type="date"
                min={manianaISO()}
                value={vencimiento}
                disabled={enviando || bloqueado}
                onChange={(e) => {
                  setVencimiento(e.target.value);
                  setError("");
                }}
              />
            </label>
          </div>

          <p className="val-juicio">JPG, PNG o WEBP de hasta 8 MB. Que se lea bien, sin reflejos y con los cuatro bordes a la vista.</p>

          {error ? <p className="val-error">{error}</p> : null}
          {ok ? <p className="val-ok">{ok}</p> : null}

          <button type="button" className="val-enviar" disabled={!listo || enviando} onClick={subir}>
            {enviando ? "Subiendo…" : `Subir ${config.nombre}`}
          </button>
        </article>
      ) : null}

      <section className="val-historial">
        <h2>Guardadas</h2>
        <p className="val-etiqueta val-origen">
          Leído de m3-vehiculos · documentos{config.requiereVehiculo && vehiculo ? ` · ${vehiculo.patente}` : ""}
        </p>

        {cargandoDocs ? <Cargando texto="Buscando documentos…" /> : null}
        {!cargandoDocs && avisoDocs ? <p className="val-error val-aviso">{avisoDocs}</p> : null}

        {!cargandoDocs && !avisoDocs && !guardadas.FRENTE && !guardadas.DORSO ? (
          <article className="val-card">
            <h2 className="val-card-titulo">Sin fotos</h2>
            <p className="val-vacio">{config.vacio}</p>
          </article>
        ) : null}

        {(["FRENTE", "DORSO"] as const).map((cara) => {
          const doc = guardadas[cara];
          if (!doc) return null;
          return (
            <article key={doc.id} className="val-mini">
              <div className="val-mini-doc">
                {doc.archivoUrl.startsWith("data:image") || doc.archivoUrl.startsWith("http") ? (
                  <img className="val-miniatura" src={doc.archivoUrl} alt={`${cara} guardado`} />
                ) : null}
                <div>
                  <p className="val-lugar">{cara === "FRENTE" ? "Frente" : "Dorso"}</p>
                  <p className="val-etiqueta">
                    {config.requiereVehiculo ? "Cédula" : "Licencia"} {doc.numeroDocumento}
                  </p>
                  <p className="val-mini-nota">Vence {fechaCalendario(doc.fechaVencimiento)}</p>
                </div>
              </div>
              <p className="val-mini-nota val-mini-puntos">Recibida</p>
            </article>
          );
        })}
      </section>

      <div className="val-acciones">
        <button type="button" className="val-secundario" onClick={() => irA(config.anterior, driverId)}>
          Volver
        </button>
        <button type="button" className="val-enviar" disabled={!completas} onClick={() => irA(config.siguiente, driverId)}>
          Continuar
        </button>
      </div>
    </>
  );
}

// ---------- Paso 5: final (neutral hasta completar y validar) ----------

type Resumen = {
  conductor: Conductor | null;
  vehiculos: Vehiculo[];
  documentos: Documento[];
};

function PasoFinal({ driverId }: { driverId: string }) {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState("");

  async function cargar() {
    setCargando(true);
    try {
      const [conductor, vehiculos, documentos] = await Promise.all([
        fetch(urlConductor(driverId)).then(async (r) => (r.ok ? ((await r.json()) as Conductor) : null)),
        pedirJson<Vehiculo[]>(urlVehiculos(driverId), "No se pudieron leer los vehículos"),
        pedirJson<Documento[]>(urlDocumentos(driverId), "No se pudieron leer los documentos")
      ]);
      setResumen({ conductor, vehiculos: vehiculos || [], documentos: documentos || [] });
      setAviso("");
    } catch (e) {
      setAviso(mensajeDe(e, "No se pudo leer tu información"));
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, [driverId]);

  const tipo = aTipo(resumen?.conductor?.tipovehiculo);
  const vehiculo = vehiculoActual(resumen?.vehiculos || [], tipo);
  const documentos = resumen?.documentos || [];
  const cedula = vehiculo ? documentoPorCara(documentos, "CEDULA_VEHICULO", vehiculo.id) : {};
  const licencia = documentoPorCara(documentos, "LICENCIA_CONDUCIR");
  const requisitos: { texto: string; ok: boolean; paso: Paso }[] = [
    { texto: "Conductor creado", ok: Boolean(resumen?.conductor), paso: "alta" },
    { texto: "Vehículo cargado", ok: Boolean(vehiculo), paso: "vehiculo" },
    { texto: "Cédula · frente", ok: Boolean(cedula.FRENTE), paso: "cedula" },
    { texto: "Cédula · dorso", ok: Boolean(cedula.DORSO), paso: "cedula" },
    { texto: "Licencia · frente", ok: Boolean(licencia.FRENTE), paso: "licencia" },
    { texto: "Licencia · dorso", ok: Boolean(licencia.DORSO), paso: "licencia" }
  ];
  const completo = requisitos.every((r) => r.ok);
  // Validado = las cuatro fotos vigentes (cédula y licencia, frente y dorso) aprobadas por m3-vehiculos
  const fotos = [
    { doc: cedula.FRENTE, paso: "cedula" as Paso },
    { doc: cedula.DORSO, paso: "cedula" as Paso },
    { doc: licencia.FRENTE, paso: "licencia" as Paso },
    { doc: licencia.DORSO, paso: "licencia" as Paso }
  ];
  const validado = completo && fotos.every((f) => f.doc?.estado === "APROBADO");
  // Pedido de nueva foto (sin mostrar el estado de habilitación)
  const rechazada = completo && !validado ? fotos.find((f) => f.doc?.estado === "RECHAZADO") : undefined;
  const pendiente = requisitos.find((r) => !r.ok);

  return (
    <>
      <Pasos actual="final" />
      <h1>{validado ? "Todo listo" : completo ? "En revisión" : "Casi listo"}</h1>
      <p className="val-subtitulo">
        {validado ? "Tu información fue validada" : completo ? "Estamos revisando tu información" : "Completá tu información para continuar"}
      </p>

      {cargando && !resumen ? <Cargando texto="Revisando tu información…" /> : null}
      {!cargando && aviso ? <p className="val-error val-aviso">{aviso}</p> : null}

      {resumen ? (
        <article className="val-card">
          <h2 className="val-card-titulo">Tu información</h2>
          <ul className="val-lista">
            {requisitos.map((r) => (
              <li key={r.texto} className={r.ok ? "val-lista-ok" : ""}>
                <span aria-hidden="true">{r.ok ? "✓" : "·"}</span>
                {r.texto}
                <small>{r.ok ? "Completo" : "Falta"}</small>
              </li>
            ))}
          </ul>

          {!completo && pendiente ? (
            <button type="button" className="val-enviar" onClick={() => irA(pendiente.paso, driverId)}>
              Completar
            </button>
          ) : null}

          {rechazada ? (
            <>
              <p className="val-vacio val-nota">
                Necesitamos una nueva foto de tu {rechazada.paso === "cedula" ? "cédula" : "licencia"} para seguir con la revisión.
              </p>
              <button type="button" className="val-enviar" onClick={() => irA(rechazada.paso, driverId)}>
                Subir de nuevo
              </button>
            </>
          ) : null}

          {completo && !validado && !rechazada ? (
            <p className="val-vacio val-nota">
              Recibimos todo. La revisión puede demorar un rato; te avisamos cuando termine.
            </p>
          ) : null}
        </article>
      ) : null}

      {validado && resumen?.conductor ? (
        <article className="val-card">
          <h2 className="val-card-titulo">Tu cuenta de conductor</h2>
          <Par izq={["Tipo de vehículo", tipo]} der={["Habilitación", resumen.conductor.habilitado]} />
        </article>
      ) : null}

      <div className="val-acciones">
        <button type="button" className="val-secundario" onClick={() => irA("licencia", driverId)}>
          Volver
        </button>
        <button type="button" className="val-secundario" disabled={cargando} onClick={cargar}>
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>
    </>
  );
}

// ---------- Raíz ----------

function leerPaso(): { paso: Paso; driverId: string } {
  const params = new URLSearchParams(window.location.search);
  const driverId = params.get("driverId") || "";
  const paso = params.get("paso") as Paso | null;
  if (driverId && paso && ORDEN_PASOS.includes(paso) && paso !== "alta") return { paso, driverId };
  return { paso: "alta", driverId };
}

function InicioSesion({ alIngresar }: { alIngresar: (token: string) => Promise<void> }) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  async function ingresar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    const datos = new FormData(evento.currentTarget);
    setEnviando(true);
    setError("");
    try {
      const respuesta = await pedirJson<{ token: string }>("/auth/iniciar-sesion", "No se pudo iniciar sesión en M1.", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: datos.get("email"), password: datos.get("password") })
      });
      if (!respuesta.token) throw new Error("M1 no devolvió un token de sesión.");
      await alIngresar(respuesta.token);
    } catch (e) {
      setError(mensajeDe(e, "No se pudo iniciar sesión en M1."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="val-card" onSubmit={ingresar}>
      <h1>Alta de conductor</h1>
      <p className="val-subtitulo">Ingresá con tu cuenta de conductor de M1.</p>
      <label className="val-comentario">
        Correo electrónico
        <input name="email" type="email" autoComplete="username" required />
      </label>
      <label className="val-comentario">
        Contraseña
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {error ? <p className="val-error" role="alert">{error}</p> : null}
      <button className="val-enviar" disabled={enviando}>
        {enviando ? "Ingresando…" : "Iniciar sesión"}
      </button>
    </form>
  );
}

export default function AltaConductor() {
  const [ruta, setRuta] = useState(leerPaso);
  const [sesion, setSesion] = useState<Awaited<ReturnType<typeof cargarSesion>> | null>(null);
  const [verificando, setVerificando] = useState(true);
  const [errorSesion, setErrorSesion] = useState("");

  useEffect(() => {
    const alCambiar = () => setRuta(leerPaso());
    window.addEventListener("popstate", alCambiar);
    const consulta = new AbortController();

    async function recuperarSesion() {
      try {
        const token = window.sessionStorage.getItem(CLAVE_SESION);
        if (token) setSesion(await cargarSesion(token, consulta.signal));
      } catch (e) {
        if (!consulta.signal.aborted) {
          setErrorSesion(mensajeDe(e, "No se pudo verificar tu sesión con M1."));
        }
      } finally {
        if (!consulta.signal.aborted) setVerificando(false);
      }
    }

    void recuperarSesion();
    return () => {
      consulta.abort();
      window.removeEventListener("popstate", alCambiar);
    };
  }, []);

  async function iniciarSesion(token: string) {
    const nuevaSesion = await cargarSesion(token);
    window.sessionStorage.setItem(CLAVE_SESION, token);
    setErrorSesion("");
    setSesion(nuevaSesion);
  }

  const driverId = sesion ? String(sesion.usuario.userId) : "";
  const rutaValida = !ruta.driverId || ruta.driverId === driverId;

  return (
    <main className="val-page">
      <style>{estilos}</style>
      <div className="val-columna">
        <a className="val-volver" href="/">Panel</a>
        {verificando ? <Cargando texto="Verificando sesión con M1…" /> : null}
        {!verificando && !sesion ? (
          <>
            {errorSesion ? <p className="val-error" role="alert">{errorSesion}</p> : null}
            <InicioSesion alIngresar={iniciarSesion} />
          </>
        ) : null}
        {sesion && !rutaValida ? (
          <p className="val-error" role="alert">
            El ID de la URL no corresponde a tu usuario de M1.{" "}
            <a className="val-volver" href="alta-conductor.html">Volver al alta</a>
          </p>
        ) : null}
        {sesion && rutaValida ? (
          <>
            {ruta.paso === "vehiculo" ? <PasoVehiculo driverId={driverId} usuario={sesion.usuario} /> : null}
            {ruta.paso === "cedula" ? <PasoDocumento key="cedula" driverId={driverId} config={CEDULA} /> : null}
            {ruta.paso === "licencia" ? <PasoDocumento key="licencia" driverId={driverId} config={LICENCIA} /> : null}
            {ruta.paso === "final" ? <PasoFinal driverId={driverId} /> : null}
            {ruta.paso === "alta" ? <PasoAlta {...sesion} /> : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

// Estilos: copia de valoraciones.tsx + campos, selector de tipo, fotos, pasos y botón secundario.
const estilos = `
  .val-page {
    min-height: 100vh;
    background: ${FONDO};
    color: ${BLANCO};
    font-family: Poppins, sans-serif;
    position: relative;
  }
  .val-page::after {
    content: "";
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    height: 32vh;
    background: radial-gradient(ellipse at center bottom, rgba(213, 255, 64, 0.2), transparent 68%);
    pointer-events: none;
  }
  .val-columna {
    position: relative;
    z-index: 1;
    width: min(400px, calc(100% - 32px));
    margin: 0 auto;
    padding: 28px 0 64px;
  }
  .val-volver {
    color: ${GRIS};
    text-decoration: none;
    font-size: 13px;
    font-weight: 600;
  }
  .val-volver:hover { color: ${BLANCO}; }
  .val-columna h1 {
    margin: 18px 0 0;
    font-size: 32px;
    line-height: 1.1;
    font-weight: 700;
    color: ${LIMA};
  }
  .val-subtitulo {
    margin: 6px 0 22px;
    color: ${GRIS};
    font-size: 14px;
  }
  .val-card, .val-mini {
    background: ${TARJETA};
    border: 1px solid rgba(192, 194, 184, 0.16);
    border-radius: 22px;
    padding: 18px 16px 16px;
    margin-bottom: 14px;
  }
  .val-card-titulo {
    margin: 0 0 14px;
    font-size: 16px;
    font-weight: 600;
  }
  .val-ruta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .val-ruta + .val-ruta { margin-top: 14px; }
  .val-ruta > div { min-width: 0; }
  .val-ruta-destino { text-align: right; }
  .val-hora, .val-lugar {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .val-lugar {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .val-etiqueta {
    margin: 2px 0 0;
    color: ${GRIS};
    font-size: 12px;
  }
  .val-calificar {
    margin: 4px 0 12px;
    text-align: center;
    font-size: 15px;
    font-weight: 600;
  }
  .val-juicio {
    margin: 8px 0 0;
    text-align: center;
    color: ${GRIS};
    font-size: 13px;
    min-height: 1.2em;
  }
  .val-opciones, .val-fotos, .val-acciones {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .val-opcion {
    border: 1px solid rgba(192, 194, 184, 0.2);
    border-radius: 14px;
    background: #101010;
    color: ${BLANCO};
    font: 600 15px Poppins, sans-serif;
    padding: 14px 12px;
    cursor: pointer;
    text-align: center;
  }
  .val-opcion small {
    display: block;
    margin-top: 2px;
    color: ${GRIS};
    font-size: 12px;
    font-weight: 400;
  }
  .val-opcion[aria-checked="true"] {
    border-color: ${LIMA};
    box-shadow: inset 0 0 0 1px ${LIMA};
  }
  .val-opcion:disabled { cursor: default; opacity: 0.6; }
  .val-opcion[aria-checked="true"]:disabled { opacity: 1; }
  .val-opcion:focus-visible { outline: 2px solid ${LIMA}; outline-offset: 2px; }
  .val-comentario {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 16px;
    min-width: 0;
    color: ${GRIS};
    font-size: 12px;
    font-weight: 600;
  }
  .val-comentario input {
    width: 100%;
    box-sizing: border-box;
    border-radius: 14px;
    border: 1px solid rgba(192, 194, 184, 0.2);
    background: #101010;
    color: ${BLANCO};
    color-scheme: dark;
    font: 400 14px/1.4 Poppins, sans-serif;
    padding: 12px;
    min-height: 46px;
  }
  .val-comentario input::placeholder { color: rgba(192, 194, 184, 0.5); }
  .val-comentario input:focus {
    outline: none;
    border-color: ${LIMA};
  }
  .val-comentario input:disabled { opacity: 0.6; }
  .val-fila {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .val-enviar, .val-secundario {
    width: 100%;
    margin-top: 14px;
    border-radius: 12px;
    font: 600 15px Poppins, sans-serif;
    padding: 12px 16px;
    cursor: pointer;
  }
  .val-enviar {
    border: 0;
    background: ${LIMA};
    color: #111111;
  }
  .val-secundario {
    border: 1px solid rgba(192, 194, 184, 0.35);
    background: #101010;
    color: ${BLANCO};
  }
  .val-enviar:hover:not(:disabled) { filter: brightness(1.05); }
  .val-secundario:hover:not(:disabled) { border-color: ${LIMA}; }
  .val-enviar:disabled, .val-secundario:disabled { opacity: 0.45; cursor: not-allowed; }
  .val-enviar:focus-visible, .val-secundario:focus-visible { outline: 2px solid ${BLANCO}; outline-offset: 2px; }
  .val-acciones .val-enviar, .val-acciones .val-secundario { margin-top: 4px; }
  .val-error { color: ${BLANCO}; font-size: 13px; margin: 10px 0 0; }
  .val-aviso { margin-bottom: 12px; }
  .val-ok { color: ${LIMA}; font-size: 13px; margin: 10px 0 0; }
  .val-vacio { margin: 0; color: ${GRIS}; font-size: 14px; line-height: 1.45; }
  .val-vacio code { color: ${BLANCO}; font-size: 13px; }
  .val-vacio .val-volver { color: ${LIMA}; }
  .val-nota { margin-top: 14px; }
  .val-historial > h2 {
    margin: 22px 0 4px;
    color: ${LIMA};
    font-size: 22px;
    font-weight: 700;
  }
  .val-origen { margin: 0 0 12px; word-break: break-all; }
  .val-mini {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
    border-radius: 16px;
  }
  .val-mini > div { min-width: 0; }
  .val-mini-nota { margin: 6px 0 0; color: ${GRIS}; font-size: 12px; }
  .val-mini-puntos { letter-spacing: 1px; color: ${LIMA}; white-space: nowrap; font-weight: 600; }
  .val-mini-doc { display: flex; gap: 12px; align-items: center; min-width: 0; }
  .val-miniatura {
    width: 64px;
    height: 42px;
    object-fit: cover;
    border-radius: 8px;
    border: 1px solid rgba(192, 194, 184, 0.2);
    flex: none;
  }
  .val-foto { min-width: 0; }
  .val-foto-caja {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1.58;
    border-radius: 14px;
    border: 1px dashed rgba(192, 194, 184, 0.35);
    background: #101010;
    overflow: hidden;
    cursor: pointer;
  }
  .val-foto-caja:hover, .val-foto-caja:focus-within { border-color: ${LIMA}; }
  .val-foto-lista { border-style: solid; border-color: rgba(213, 255, 64, 0.6); }
  .val-foto-caja input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .val-foto-caja img { width: 100%; height: 100%; object-fit: cover; }
  .val-foto-vacia {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px;
    color: ${GRIS};
    font-size: 11px;
    font-weight: 600;
    text-align: center;
  }
  .val-foto-pie {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 6px;
    margin-top: 6px;
  }
  .val-foto-pie .val-etiqueta { font-size: 10px; text-align: right; }
  .val-link {
    border: 0;
    background: none;
    padding: 0;
    color: ${LIMA};
    font: 600 12px Poppins, sans-serif;
    cursor: pointer;
  }
  .val-lista { list-style: none; margin: 0; padding: 0; }
  .val-lista li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
    border-top: 1px solid rgba(192, 194, 184, 0.1);
    font-size: 14px;
    font-weight: 600;
    color: ${GRIS};
  }
  .val-lista li:first-child { border-top: 0; padding-top: 0; }
  .val-lista li span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1px solid rgba(192, 194, 184, 0.3);
    font-size: 12px;
    flex: none;
  }
  .val-lista li small { margin-left: auto; font-size: 12px; font-weight: 400; }
  .val-lista-ok { color: ${BLANCO} !important; }
  .val-lista-ok span { background: ${LIMA}; border-color: ${LIMA} !important; color: #111111; }
  .val-pasos {
    display: flex;
    gap: 6px;
    margin: 18px 0 0;
  }
  .val-pasos span {
    flex: 1;
    height: 4px;
    border-radius: 4px;
    background: rgba(192, 194, 184, 0.2);
  }
  .val-pasos span.activo { background: ${LIMA}; }
`;

const root = document.getElementById("alta-conductor-root");
if (root) {
  createRoot(root).render(<AltaConductor />);
}

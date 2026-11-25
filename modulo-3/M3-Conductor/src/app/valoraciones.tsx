import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  cerrarSesionM1,
  headersAuthM1,
  resolverSesionM1,
  type SesionM1,
  type UsuarioM1
} from "./m1Session";
import { LoginM1Card } from "./LoginM1Card";

const LIMA = "#D5FF40";
const GRIS = "#C0C2B8";
const BLANCO = "#FFFFFF";
const FONDO = "#0C0C0C";
const TARJETA = "#141414";

const ETIQUETAS = ["Elegí de 1 a 5", "Malo", "Regular", "Bien", "Muy bien", "Perfecto"] as const;

function urlApi(ruta: string) {
  const { port, pathname } = window.location;
  const preview = pathname.includes("/public/") || port === "3001";
  return `${preview ? "http://127.0.0.1:3000" : ""}${ruta}`;
}

type Pendiente = {
  viajeId: string;
  evaluadorId: string;
  evaluadoId: string;
  estado?: string;
  habilitadaDesde?: string;
};

type ValoracionHecha = {
  id: string;
  evaluadorId: string;
  evaluadoId: string;
  valoracion: number;
  comentario?: string;
  viajeId?: string | null;
  fecha?: string;
};

type Borrador = {
  estrellas: number;
  comentario: string;
  enviando: boolean;
  enviado: boolean;
  error: string;
};

const borradorVacio = (): Borrador => ({
  estrellas: 0,
  comentario: "",
  enviando: false,
  enviado: false,
  error: ""
});

function horaDe(iso?: string) {
  if (!iso) return "—";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "—";
  return fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function fechaDe(iso?: string) {
  if (!iso) return "—";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "—";
  return fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function Estrella({ activa }: { activa: boolean }) {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2.4l2.76 5.59 6.17.9-4.46 4.35 1.05 6.14L12 16.77 6.48 19.38l1.05-6.14L3.07 8.89l6.17-.9L12 2.4z"
        fill={activa ? LIMA : "rgba(192,194,184,0.28)"}
      />
    </svg>
  );
}

function Estrellas({
  valor,
  onChange,
  deshabilitado
}: {
  valor: number;
  onChange: (valor: number) => void;
  deshabilitado?: boolean;
}) {
  const [hover, setHover] = useState(0);
  const visible = hover || valor;

  return (
    <div
      className="val-estrellas"
      role="radiogroup"
      aria-label="Puntaje del cliente"
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={valor === n}
          aria-label={`${n} ${n === 1 ? "estrella" : "estrellas"}`}
          className="val-estrella"
          disabled={deshabilitado}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(0)}
          onClick={() => onChange(n)}
        >
          <Estrella activa={n <= visible} />
        </button>
      ))}
    </div>
  );
}

function TarjetaViaje({
  pendiente,
  borrador,
  onChange,
  onEnviar
}: {
  pendiente: Pendiente;
  borrador: Borrador;
  onChange: (parcial: Partial<Borrador>) => void;
  onEnviar: () => void;
}) {
  const bloqueada = borrador.enviando || borrador.enviado;

  return (
    <article className="val-card">
      <h2 className="val-card-titulo">Viaje finalizado</h2>

      <div className="val-ruta">
        <div>
          <p className="val-hora">{horaDe(pendiente.habilitadaDesde)}</p>
          <p className="val-etiqueta">Finalizó</p>
        </div>
        <div className="val-ruta-destino">
          <p className="val-hora">{fechaDe(pendiente.habilitadaDesde)}</p>
          <p className="val-etiqueta">Fecha</p>
        </div>
      </div>

      <div className="val-ruta val-ruta-ids">
        <div>
          <p className="val-lugar">{pendiente.evaluadoId}</p>
          <p className="val-etiqueta">Cliente</p>
        </div>
        <div className="val-ruta-destino">
          <p className="val-lugar">{pendiente.viajeId}</p>
          <p className="val-etiqueta">Viaje</p>
        </div>
      </div>

      <p className="val-calificar">Calificá al cliente</p>
      <Estrellas
        valor={borrador.estrellas}
        deshabilitado={bloqueada}
        onChange={(estrellas) => onChange({ estrellas, error: "" })}
      />
      <p className="val-juicio">{ETIQUETAS[borrador.estrellas]}</p>

      <label className="val-comentario">
        <span>Comentario</span>
        <textarea
          rows={3}
          maxLength={280}
          placeholder="Cómo fue el viaje con este cliente"
          value={borrador.comentario}
          disabled={bloqueada}
          onChange={(evento) => onChange({ comentario: evento.target.value })}
        />
      </label>

      {borrador.error ? <p className="val-error">{borrador.error}</p> : null}

      <button
        type="button"
        className={borrador.enviado ? "val-enviar val-enviar-lista" : "val-enviar"}
        disabled={bloqueada || borrador.estrellas < 1}
        onClick={onEnviar}
      >
        {borrador.enviado ? "Valoración enviada" : borrador.enviando ? "Enviando…" : "Enviar valoración"}
      </button>
    </article>
  );
}

export default function ValoracionesConductor() {
  const [usuario, setUsuario] = useState<UsuarioM1 | null>(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [enviadas, setEnviadas] = useState<ValoracionHecha[]>([]);
  const [borradores, setBorradores] = useState<Record<string, Borrador>>({});
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState("");
  const [demoEstado, setDemoEstado] = useState("");
  const [demoError, setDemoError] = useState("");
  const [demoCorriendo, setDemoCorriendo] = useState(false);

  const conductorId = usuario ? String(usuario.id) : "";

  useEffect(() => {
    resolverSesionM1()
      .then((sesion) => {
        if (sesion) setUsuario(sesion.usuario);
      })
      .finally(() => setCargandoSesion(false));
  }, []);

  async function cargar(idActual = conductorId) {
    if (!idActual) {
      setPendientes([]);
      setEnviadas([]);
      setCargando(false);
      return;
    }
    try {
      const headers = { Accept: "application/json", ...headersAuthM1() };
      const [resPendientes, resHistorial] = await Promise.all([
        fetch(urlApi("/api/valoraciones/pendientes"), { headers }),
        fetch(urlApi(`/api/conductor/valoraciones?evaluadorId=${encodeURIComponent(idActual)}`), { headers })
      ]);
      if (!resPendientes.ok) throw new Error("No se pudieron leer los viajes pendientes");
      const lista = (await resPendientes.json()) as Pendiente[];
      const propias = (Array.isArray(lista) ? lista : []).filter(
        (item) => String(item.evaluadorId) === idActual
      );
      setPendientes(propias);
      setAviso("");

      if (resHistorial.ok) {
        const data = (await resHistorial.json()) as ValoracionHecha[];
        const listaHistorial = Array.isArray(data) ? data : [];
        setEnviadas(listaHistorial.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")));
      } else {
        setEnviadas([]);
      }
    } catch (error) {
      setAviso(error instanceof Error ? error.message : "No hay conexión con la API");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    if (cargandoSesion) return;
    if (!conductorId) {
      setCargando(false);
      return;
    }
    setCargando(true);
    cargar(conductorId);
    const stream = new EventSource(urlApi("/api/valoraciones/notificaciones/stream"));
    stream.onmessage = () => {
      cargar(conductorId);
    };
    return () => stream.close();
  }, [conductorId, cargandoSesion]);

  function alIngresar(sesion: SesionM1) {
    setUsuario(sesion.usuario);
    setCargandoSesion(false);
  }

  function alSalir() {
    cerrarSesionM1();
    setUsuario(null);
    setPendientes([]);
    setEnviadas([]);
  }

  function actualizar(viajeId: string, parcial: Partial<Borrador>) {
    setBorradores((actual) => ({
      ...actual,
      [viajeId]: { ...(actual[viajeId] || borradorVacio()), ...parcial }
    }));
  }

  async function enviar(pendiente: Pendiente) {
    const borrador = borradores[pendiente.viajeId] || borradorVacio();
    if (borrador.estrellas < 1 || borrador.enviando || borrador.enviado) return;

    actualizar(pendiente.viajeId, { enviando: true, error: "" });
    try {
      const respuesta = await fetch(urlApi("/api/conductor/valoraciones"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...headersAuthM1()
        },
        body: JSON.stringify({
          evaluadorId: conductorId || pendiente.evaluadorId,
          evaluadoId: pendiente.evaluadoId,
          valoracion: borrador.estrellas,
          comentario: borrador.comentario.trim(),
          viajeId: pendiente.viajeId
        })
      });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) {
        throw new Error(cuerpo.error || "No se pudo registrar la valoración");
      }
      actualizar(pendiente.viajeId, { enviando: false, enviado: true });
      setEnviadas((lista) => [cuerpo as ValoracionHecha, ...lista.filter((item) => item.id !== cuerpo.id)]);
    } catch (error) {
      actualizar(pendiente.viajeId, {
        enviando: false,
        error: error instanceof Error ? error.message : "Error al enviar"
      });
    }
  }

  async function finalizarViajePrueba() {
    if (demoCorriendo || !conductorId) return;
    setDemoCorriendo(true);
    setDemoError("");
    setDemoEstado("Creando y finalizando viaje en M6…");
    try {
      const respuesta = await fetch(urlApi("/api/valoraciones/demo-viaje-finalizado"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...headersAuthM1()
        },
        body: JSON.stringify({
          clienteId: "cliente-001",
          conductorId
        })
      });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) {
        const paso = cuerpo.paso ? ` (paso: ${cuerpo.paso})` : "";
        throw new Error((cuerpo.error || "No se pudo finalizar el viaje de prueba") + paso);
      }
      setDemoEstado(`Viaje ${cuerpo.viajeId} finalizado. Esperando valoración pendiente…`);
      await cargar(conductorId);
      window.setTimeout(() => cargar(conductorId), 1500);
    } catch (error) {
      setDemoEstado("");
      setDemoError(error instanceof Error ? error.message : "Error al finalizar el viaje");
    } finally {
      setDemoCorriendo(false);
    }
  }

  return (
    <main className="val-page">
      <style>{estilos}</style>
      <div className="val-columna">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <a className="val-volver" href="/">
              Panel
            </a>
            <a className="val-volver" href="/alta-conductor.html">
              Alta conductor
            </a>
          </div>
          {usuario ? (
            <button type="button" className="val-link" onClick={alSalir}>
              Cerrar sesión (#{usuario.id})
            </button>
          ) : null}
        </div>
        <h1>Valoraciones</h1>
        <p className="val-subtitulo">
          {usuario
            ? `Conductor #${usuario.id}${usuario.nombre ? ` · ${usuario.nombre}` : ""}`
            : "Conductor al cliente"}
        </p>

        {cargandoSesion ? (
          <article className="val-card">
            <p className="val-etiqueta">Verificando sesión con M1…</p>
          </article>
        ) : !usuario ? (
          <LoginM1Card
            subtitulo="Ingresá con tu cuenta CONDUCTOR de M1 para ver tus viajes finalizados y calificar clientes."
            onLogin={alIngresar}
          />
        ) : (
          <>
            <article className="val-card">
              <h2 className="val-card-titulo">Probar comunicación con Viajes</h2>
              <p className="val-vacio">
                Dispara el ciclo real de M6 (crear, asignar, arribo, iniciar y finalizar) con tu ID
                de conductor ({conductorId}). Al completar, M6 publica viaje.finalizado y aparece la
                tarjeta para valorar.
              </p>
              <button
                type="button"
                className="val-enviar"
                disabled={demoCorriendo}
                onClick={finalizarViajePrueba}
              >
                {demoCorriendo ? "Finalizando viaje…" : "Finalizar viaje de prueba"}
              </button>
              {demoEstado ? <p className="val-etiqueta" style={{ marginTop: "0.75rem" }}>{demoEstado}</p> : null}
              {demoError ? <p className="val-error val-aviso">{demoError}</p> : null}
            </article>

            {cargando ? (
              <article className="val-card">
                <p className="val-etiqueta">Buscando viajes finalizados…</p>
              </article>
            ) : null}

            {!cargando && aviso ? <p className="val-error val-aviso">{aviso}</p> : null}

            {!cargando && pendientes.length === 0 ? (
              <article className="val-card">
                <h2 className="val-card-titulo">Sin viajes para valorar</h2>
                <p className="val-vacio">
                  Cuando un viaje finaliza, el cliente aparece en esta tarjeta para que lo califiques.
                </p>
              </article>
            ) : null}

            {pendientes.map((pendiente) => (
              <TarjetaViaje
                key={pendiente.viajeId}
                pendiente={pendiente}
                borrador={borradores[pendiente.viajeId] || borradorVacio()}
                onChange={(parcial) => actualizar(pendiente.viajeId, parcial)}
                onEnviar={() => enviar(pendiente)}
              />
            ))}

            {enviadas.length > 0 ? (
              <section className="val-historial">
                <h2>Enviadas</h2>
                {enviadas.map((item) => (
                  <article key={item.id} className="val-mini">
                    <div>
                      <p className="val-lugar">{item.evaluadoId}</p>
                      <p className="val-etiqueta">{item.viajeId || "Sin viaje"} · {fechaDe(item.fecha)}</p>
                      {item.comentario ? <p className="val-mini-nota">{item.comentario}</p> : null}
                    </div>
                    <p className="val-mini-nota val-mini-puntos" aria-label={`${item.valoracion} de 5`}>
                      {"★".repeat(item.valoracion)}
                      <span>{"★".repeat(Math.max(0, 5 - item.valoracion))}</span>
                    </p>
                  </article>
                ))}
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

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
  .val-ruta-ids { margin-top: 14px; }
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
    margin: 18px 0 8px;
    text-align: center;
    font-size: 15px;
    font-weight: 600;
  }
  .val-estrellas {
    display: flex;
    justify-content: center;
    gap: 4px;
  }
  .val-estrella {
    border: 0;
    padding: 2px;
    background: transparent;
    cursor: pointer;
    border-radius: 8px;
  }
  .val-estrella:disabled { cursor: default; }
  .val-estrella:focus-visible {
    outline: 2px solid ${LIMA};
    outline-offset: 2px;
  }
  .val-juicio {
    margin: 4px 0 0;
    text-align: center;
    color: ${GRIS};
    font-size: 13px;
    min-height: 1.2em;
  }
  .val-comentario {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 16px;
    color: ${GRIS};
    font-size: 12px;
    font-weight: 600;
  }
  .val-comentario textarea {
    width: 100%;
    box-sizing: border-box;
    resize: none;
    border-radius: 14px;
    border: 1px solid rgba(192, 194, 184, 0.2);
    background: #101010;
    color: ${BLANCO};
    font: 400 14px/1.4 Poppins, sans-serif;
    padding: 12px;
  }
  .val-comentario textarea:focus {
    outline: none;
    border-color: ${LIMA};
  }
  .val-enviar {
    width: 100%;
    margin-top: 14px;
    border: 0;
    border-radius: 12px;
    background: ${LIMA};
    color: #111111;
    font: 600 15px Poppins, sans-serif;
    padding: 12px 16px;
    cursor: pointer;
  }
  .val-enviar:hover:not(:disabled) { filter: brightness(1.05); }
  .val-enviar:disabled { opacity: 0.45; cursor: not-allowed; }
  .val-enviar-lista:disabled { opacity: 1; }
  .val-enviar:focus-visible { outline: 2px solid ${BLANCO}; outline-offset: 2px; }
  .val-error { color: ${BLANCO}; font-size: 13px; margin: 10px 0 0; }
  .val-aviso { margin-bottom: 12px; }
  .val-vacio { margin: 0; color: ${GRIS}; font-size: 14px; line-height: 1.45; }
  .val-historial h2 {
    margin: 22px 0 12px;
    color: ${LIMA};
    font-size: 22px;
    font-weight: 700;
  }
  .val-mini {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
    border-radius: 16px;
  }
  .val-mini-nota { margin: 6px 0 0; color: ${GRIS}; font-size: 12px; }
  .val-mini-puntos { letter-spacing: 1px; color: ${LIMA}; white-space: nowrap; }
  .val-mini-puntos span { color: rgba(192, 194, 184, 0.35); }
  .val-campo { display: block; }
  .val-campo span { display: block; font-size: 12px; color: ${GRIS}; margin-bottom: 6px; }
  .val-campo input {
    box-sizing: border-box;
    width: 100%;
    border-radius: 12px;
    border: 1px solid rgba(192, 194, 184, 0.2);
    background: #101010;
    color: ${BLANCO};
    font: 400 14px/1.4 Poppins, sans-serif;
    padding: 11px 12px;
  }
  .val-campo input:focus { outline: none; border-color: ${LIMA}; }
  .val-link {
    border: 0;
    background: none;
    padding: 0;
    color: ${LIMA};
    font: 600 12px Poppins, sans-serif;
    cursor: pointer;
  }
`;

const root = document.getElementById("valoraciones-root");
if (root) {
  createRoot(root).render(<ValoracionesConductor />);
}

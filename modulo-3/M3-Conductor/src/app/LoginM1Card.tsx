import { useState, type FormEvent } from "react";
import { iniciarSesionM1, type SesionM1 } from "./m1Session";

export function LoginM1Card({
  titulo = "Iniciar sesión (M1)",
  subtitulo = "Ingresá con tu cuenta CONDUCTOR registrada en M1. Tu ID de M1 se usa como usuarioID en M3.",
  onLogin
}: {
  titulo?: string;
  subtitulo?: string;
  onLogin: (sesion: SesionM1) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password || enviando) return;
    setEnviando(true);
    setError("");
    try {
      const sesion = await iniciarSesionM1(email, password);
      onLogin(sesion);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión en M1");
      setEnviando(false);
    }
  }

  return (
    <article className="val-card">
      <h2 className="val-card-titulo">{titulo}</h2>
      <p className="val-vacio">{subtitulo}</p>
      <form onSubmit={enviar} style={{ marginTop: 14, display: "grid", gap: 12 }}>
        <label className="val-campo">
          <span>Email de M1</span>
          <input
            type="email"
            required
            autoComplete="username"
            placeholder="conductor@ejemplo.com"
            value={email}
            disabled={enviando}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="val-campo">
          <span>Contraseña</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            disabled={enviando}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <p className="val-error">{error}</p> : null}
        <button type="submit" className="val-enviar" disabled={enviando || !email.trim() || !password}>
          {enviando ? "Validando en M1…" : "Ingresar con M1"}
        </button>
      </form>
    </article>
  );
}

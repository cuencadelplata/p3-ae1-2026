import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import axios from 'axios'
import { API_URL } from '../api'
import OAuth2Login from './OAuth2Login'

interface LoginProps {
  aviso?: string
  onLoginSuccess: (token: string, user: any) => void
  onSwitchToRegister: () => void
  onSwitchToRecovery: () => void
}

export default function Login({ aviso, onLoginSuccess, onSwitchToRegister, onSwitchToRecovery }: LoginProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // RF-1.2: segundos que faltan para que M1 desbloquee la IP después de un 429.
  const [bloqueadoPor, setBloqueadoPor] = useState(0)

  useEffect(() => {
    if (bloqueadoPor <= 0) return
    const timer = setTimeout(() => setBloqueadoPor(bloqueadoPor - 1), 1000)
    return () => clearTimeout(timer)
  }, [bloqueadoPor])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await axios.post(`${API_URL}/auth/iniciar-sesion`, {
        email,
        password,
      })

      const { token } = response.data
      const parts = token.split('.')
      const decoded = JSON.parse(atob(parts[1]))

      onLoginSuccess(token, { ...decoded, ...response.data.usuario })
    } catch (err: any) {
      if (err.response?.status === 429) {
        // Rate limit de RF-1.2: demasiados intentos fallidos desde esta IP.
        setBloqueadoPor(Number(err.response.headers['retry-after'] ?? err.response.data?.retryAfterSeconds ?? 60))
      }
      setError(err.response?.data?.error || err.response?.data?.message || 'No se pudo conectar con M1')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="glass rounded-[1.75rem] p-9 md:p-11">
        {/* Encabezado */}
        <div className="mb-9">
          <p className="eyebrow">Acceso</p>
          <h1 className="display text-[2.6rem] mt-3 mb-2">Bienvenido</h1>
          <p className="text-sm text-[var(--text-soft)]">
            Ingresá tus credenciales para continuar.
          </p>
        </div>

        <div className="hairline mb-8" />

        {aviso && !error && <div className="alert-success mb-6 text-sm">{aviso}</div>}
        {error && (
          <div className="alert-error mb-6 text-sm">
            {error}
            {bloqueadoPor > 0 && <> · Probá de nuevo en {bloqueadoPor} s</>}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="field-label">Email</label>
            <div className="relative">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="tu@email.com"
                required
              />
            </div>
          </div>

          <div>
            <label className="field-label">Contraseña</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field pr-11"
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-dim)] hover:text-[var(--gold)] transition-colors"
                aria-label="Mostrar contraseña"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading || bloqueadoPor > 0} className="btn-primary mt-2">
            {loading ? 'Iniciando sesión…' : bloqueadoPor > 0 ? `Bloqueado (${bloqueadoPor} s)` : 'Iniciar sesión'}
          </button>
        </form>

        <button
          type="button"
          onClick={onSwitchToRecovery}
          className="mt-5 w-full text-xs tracking-[0.12em] text-[var(--text-soft)] hover:text-[var(--gold)] transition-colors"
        >
          ¿Olvidaste tu contraseña?
        </button>

        <div className="hairline my-9" />

        <OAuth2Login />

        <div className="hairline my-9" />

        <button onClick={onSwitchToRegister} className="btn-secondary">
          Crear una cuenta
        </button>
      </div>
    </div>
  )
}
